import { Injectable, Logger } from '@nestjs/common';
import algosdk from 'algosdk';
import {
  buildSettlementGroup,
  computePlatformFee,
  waitForConfirmation,
  getAlgodClient,
} from '@chainstrike/algorand';
import { algorandConfig, FeeSchedule, PlatformConstants } from '@chainstrike/config';
import { EventProducerService } from '../events/event-producer.service';
import { SettlementRepository } from './settlement.repository';
import { SignatureCollectorService } from '../signature/signature-collector.service';
import { Topics } from '@chainstrike/events';
import { OrderMatchedPayload, TradeSettledPayload, SettlementFailedPayload } from '@chainstrike/types';

// ─────────────────────────────────────────────────────────────────────────────
// Settlement Service
//
// Receives ORDER_MATCHED events from the Matching Engine.
// Constructs an Algorand atomic transaction group for T+0 settlement.
// Uses SignatureCollectorService to get seller's wallet signature via WebSocket.
// Broadcasts to Algorand network and waits for confirmation.
//
// The atomic group ensures: either BOTH sides complete (tokens + USDC)
// or NEITHER executes. No partial settlement is possible.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  private readonly algoCfg = algorandConfig();
  private readonly adminAccount: algosdk.Account;

  constructor(
    private readonly settlementRepo: SettlementRepository,
    private readonly events: EventProducerService,
    private readonly signatureCollector: SignatureCollectorService,
  ) {
    // Load admin account from mnemonic for signing escrow + settlement contract calls
    const mnemonic = process.env['ALGORAND_ADMIN_MNEMONIC'];
    if (!mnemonic) {
      throw new Error('ALGORAND_ADMIN_MNEMONIC is required');
    }
    this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  }

  // ─── Process a matched trade ──────────────────────────────────────────────────

  async processMatch(payload: OrderMatchedPayload): Promise<void> {
    const price = BigInt(payload.price);
    const quantity = BigInt(payload.quantity);
    // DEV_SKIP_USDC_PAYMENT=true: sends 0-amount USDC txns (valid no-ops, admin is opted-in)
    // Use when admin has no testnet USDC but you still want to validate the full settlement flow.
    const skipUsdc = process.env['DEV_SKIP_USDC_PAYMENT'] === 'true';
    const usdcAmount = skipUsdc ? 0n : price * quantity / PlatformConstants.USDC_SCALE;
    const platformFee = skipUsdc ? 0n : computePlatformFee(usdcAmount, FeeSchedule.TAKER_FEE_RATE, FeeSchedule.MIN_FEE_USDC);
    if (skipUsdc) this.logger.warn(`[DEV] USDC payment skipped for trade ${payload.tradeId}`);

    // Create settlement record
    const settlement = await this.settlementRepo.create({
      tradeId: payload.tradeId,
      asaId: payload.asaId,
      assetId: payload.assetId,
      buyerUserId: payload.buyerUserId ?? payload.buyerWalletAddress,
      sellerUserId: payload.sellerUserId ?? payload.sellerWalletAddress,
      buyerWalletAddress: payload.buyerWalletAddress,
      sellerWalletAddress: payload.sellerWalletAddress,
      tokenAmount: quantity,
      usdcAmount,
      platformFee,
      status: 'AWAITING_SIGNATURES',
    });

    await this.attemptSettlement(settlement.id, payload, usdcAmount, platformFee, quantity);
  }

  // ─── Execute settlement with retry ───────────────────────────────────────────

  private async attemptSettlement(
    settlementId: string,
    payload: OrderMatchedPayload,
    usdcAmount: bigint,
    platformFee: bigint,
    tokenAmount: bigint,
    attempt = 1,
  ): Promise<void> {
    if (attempt > PlatformConstants.SETTLEMENT_MAX_RETRIES) {
      await this.settlementRepo.updateStatus(settlementId, 'FAILED', `Max retries (${PlatformConstants.SETTLEMENT_MAX_RETRIES}) exceeded`);
      await this.events.emit<SettlementFailedPayload>(Topics.SETTLEMENT_FAILED, {
        tradeId: payload.tradeId,
        attempt,
        reason: 'Max settlement retries exceeded',
      });
      return;
    }

    try {
      await this.settlementRepo.updateStatus(settlementId, 'SUBMITTING');
      await this.settlementRepo.addLog(settlementId, attempt, 'Constructing atomic transaction group');

      const algod = getAlgodClient({
        host: this.algoCfg.algodHost,
        port: this.algoCfg.algodPort,
        token: this.algoCfg.algodToken,
        network: this.algoCfg.network,
      });

      const suggestedParams = await algod.getTransactionParams().do();

      // Build the 4-transaction atomic group
      const txns = buildSettlementGroup(
        {
          tradeId: payload.tradeId,
          buyerAddress: payload.buyerWalletAddress,
          sellerAddress: payload.sellerWalletAddress,
          adminAddress: this.adminAccount.addr.toString(),
          asaId: payload.asaId,
          tokenAmount,
          usdcAmount: usdcAmount - platformFee,
          platformFee,
          treasuryAddress: process.env['TREASURY_WALLET_ADDRESS']!,
        },
        suggestedParams,
        parseInt(process.env['ESCROW_CONTRACT_APP_ID'] ?? '0', 10),
        this.algoCfg.usdcAssetId,
      );

      // Txn 0 = token transfer (seller must sign via WebSocket)
      // Txn 1 = USDC payment (admin signs — admin is custodian holding USDC)
      // Txn 2 = platform fee (admin signs)
      // Txn 3 = settlement app call, if contract deployed (admin signs)
      const adminSignedTxns: (Uint8Array | null)[] = new Array(txns.length).fill(null);
      for (let i = 1; i < txns.length; i++) {
        adminSignedTxns[i] = txns[i]!.signTxn(this.adminAccount.sk);
      }

      // Request seller's signature for token transfer (Txn 0) via WebSocket
      const sellerSigned = await this.signatureCollector.requestSignatures(
        payload.tradeId,
        txns,
        payload.sellerWalletAddress,
      );

      if (!sellerSigned) {
        await this.settlementRepo.updateStatus(settlementId, 'FAILED', 'Signature timeout or seller not connected');
        await this.settlementRepo.addLog(settlementId, attempt, 'Seller signature timeout');
        this.logger.warn(`Seller ${payload.sellerWalletAddress} did not sign for trade ${payload.tradeId}`);
        return;
      }

      // Assemble the complete signed atomic group
      const signedTxns: Uint8Array[] = [];
      for (let i = 0; i < txns.length; i++) {
        if (i === 0) {
          signedTxns.push(sellerSigned[i]!);
        } else {
          signedTxns.push(adminSignedTxns[i]!);
        }
      }

      // Broadcast atomic group to Algorand
      const { txid } = await algod.sendRawTransaction(signedTxns).do();
      const txId = txid;
      await this.settlementRepo.addLog(settlementId, attempt, 'TX submitted', txId);
      await this.settlementRepo.updateStatus(settlementId, 'CONFIRMING', undefined, txId);

      // Wait for confirmation (~4 second block time)
      const confirmation = await waitForConfirmation(algod, txId, 8);

      await this.settlementRepo.updateStatus(settlementId, 'SETTLED', undefined, txId);
      await this.settlementRepo.setConfirmedRound(settlementId, confirmation['confirmed-round'] as number);

      this.logger.log(`Trade settled on-chain: tradeId=${payload.tradeId}, txId=${txId}`);

      await this.events.emit<TradeSettledPayload>(Topics.TRADE_SETTLED, {
        tradeId: payload.tradeId,
        assetId: payload.assetId,
        asaId: payload.asaId,
        buyerUserId: payload.buyerUserId ?? payload.buyerWalletAddress,
        sellerUserId: payload.sellerUserId ?? payload.sellerWalletAddress,
        price: (usdcAmount / tokenAmount).toString(),
        quantity: tokenAmount.toString(),
        onChainTxId: txId,
        settledAt: new Date().toISOString(),
      });

    } catch (error: any) {
      const errMsg = error?.message ?? 'Unknown error';
      this.logger.warn(`Settlement attempt ${attempt} failed: ${errMsg}`);
      await this.settlementRepo.addLog(settlementId, attempt, 'Failed', undefined, errMsg);

      // Retry after backoff
      const backoffMs = attempt * 2000;
      setTimeout(() => {
        this.attemptSettlement(settlementId, payload, usdcAmount, platformFee, tokenAmount, attempt + 1)
          .catch((e) => this.logger.error('Retry error:', e));
      }, backoffMs);
    }
  }
}
