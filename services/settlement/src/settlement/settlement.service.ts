import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { Topics } from '@chainstrike/events';
import { OrderMatchedPayload, TradeSettledPayload, SettlementFailedPayload } from '@chainstrike/types';

// ─────────────────────────────────────────────────────────────────────────────
// Settlement Service
//
// Receives ORDER_MATCHED events from the Matching Engine.
// Constructs an Algorand atomic transaction group for T+0 settlement.
// Admin (platform custodian) signs all transactions:
//   - Clawback of frozen RWA tokens from seller → buyer
//   - USDC payment from admin's held funds → seller
//   - Platform fee → treasury
// Broadcasts to Algorand network and waits for confirmation.
//
// The atomic group ensures: either BOTH sides complete (tokens + USDC)
// or NEITHER executes. No partial settlement is possible.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);
  private readonly algoCfg = algorandConfig();
  private readonly adminAccount: algosdk.Account;

  constructor(
    private readonly settlementRepo: SettlementRepository,
    private readonly events: EventProducerService,
  ) {
    const mnemonic = process.env['ALGORAND_ADMIN_MNEMONIC'];
    if (!mnemonic) {
      throw new Error('ALGORAND_ADMIN_MNEMONIC is required');
    }
    this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  }

  // Ensure admin is opted into USDC on every startup so Txn 1 (USDC payment) never fails
  async onModuleInit() {
    try {
      const algod = getAlgodClient({
        host: this.algoCfg.algodHost,
        port: this.algoCfg.algodPort,
        token: this.algoCfg.algodToken,
        network: this.algoCfg.network,
      });

      const info = await algod
        .accountAssetInformation(this.adminAccount.addr, this.algoCfg.usdcAssetId)
        .do()
        .catch(() => null);

      if (info) {
        const holding = (info as any).assetHolding ?? (info as any)['asset-holding'];
        const balance = BigInt(holding?.amount ?? 0);
        this.logger.log(`Admin opted into USDC ✓ (balance: ${Number(balance) / 1_000_000} USDC)`);
        return;
      }

      // Not opted in — do the 0-amount self-transfer opt-in
      const sp = await algod.getTransactionParams().do();
      const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: this.adminAccount.addr,
        receiver: this.adminAccount.addr,
        assetIndex: this.algoCfg.usdcAssetId,
        amount: 0n,
        suggestedParams: sp,
      });
      const signed = optIn.signTxn(this.adminAccount.sk);
      const { txid } = await algod.sendRawTransaction(signed).do();
      await waitForConfirmation(algod, txid, 4);
      this.logger.log(`Admin opted into USDC (txId=${txid})`);
    } catch (err) {
      this.logger.warn(`USDC opt-in check failed: ${(err as Error).message} — ensure ALGORAND_ALGOD_SERVER is reachable`);
    }
  }

  async findByTradeId(tradeId: string) {
    return this.settlementRepo.findByTradeId(tradeId);
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

    const algod = getAlgodClient({
      host: this.algoCfg.algodHost,
      port: this.algoCfg.algodPort,
      token: this.algoCfg.algodToken,
      network: this.algoCfg.network,
    });

    try {
      await this.settlementRepo.updateStatus(settlementId, 'SUBMITTING');
      await this.settlementRepo.addLog(settlementId, attempt, 'Constructing atomic transaction group');

      const suggestedParams = await algod.getTransactionParams().do();

      // Verify buyer has opted into the ASA — clawback will fail on-chain if not
      const buyerAssetInfo = await algod
        .accountAssetInformation(payload.buyerWalletAddress, payload.asaId)
        .do()
        .catch(() => null);
      if (!buyerAssetInfo) {
        throw new Error(
          `Buyer ${payload.buyerWalletAddress} has not opted in to ASA ${payload.asaId}. ` +
          `Settlement cannot proceed until the investor opts in.`,
        );
      }

      // Verify seller has opted in AND holds sufficient tokens — if not, clawback will fail on-chain
      const sellerAssetInfo = await algod
        .accountAssetInformation(payload.sellerWalletAddress, payload.asaId)
        .do()
        .catch(() => null);
      if (!sellerAssetInfo) {
        throw new Error(`Seller ${payload.sellerWalletAddress} has not opted in to ASA ${payload.asaId}`);
      }
      const sellerBalance = BigInt(
        sellerAssetInfo.assetHolding?.amount ??
        (sellerAssetInfo as any)['asset-holding']?.amount ?? 0,
      );
      if (sellerBalance < tokenAmount) {
        throw new Error(
          `Seller ${payload.sellerWalletAddress} has insufficient ASA balance: ` +
          `has ${sellerBalance}, needs ${tokenAmount}`,
        );
      }

      // Treasury = admin wallet for testnet (platform collects fees into admin account)
      const treasuryAddress =
        process.env['TREASURY_WALLET_ADDRESS'] ?? this.adminAccount.addr.toString();

      // Build settlement group:
      // Txn 0: ASA clawback (tokens: seller → buyer)
      // Txn 1: escrow.releaseToSeller ABI call (USDC: escrow → seller + fee → treasury)
      //        Falls back to direct admin USDC transfer if no escrow contract/orderId.
      const txns = buildSettlementGroup(
        {
          tradeId: payload.tradeId,
          buyOrderId: payload.buyOrderId,
          buyerAddress: payload.buyerWalletAddress,
          sellerAddress: payload.sellerWalletAddress,
          adminAddress: this.adminAccount.addr.toString(),
          asaId: payload.asaId,
          tokenAmount,
          usdcAmount: usdcAmount - platformFee,
          platformFee,
          treasuryAddress,
        },
        suggestedParams,
        parseInt(process.env['ESCROW_CONTRACT_APP_ID'] ?? '0', 10),
        this.algoCfg.usdcAssetId,
      );

      // Admin signs all transactions in the atomic group:
      // Txn 0 = ASA clawback (admin is clawback authority for defaultFrozen RWA tokens)
      // Txn 1 = escrow.releaseToSeller ABI call (admin is authorized caller on escrow contract)
      const signedTxns: Uint8Array[] = txns.map((txn) => txn.signTxn(this.adminAccount.sk));

      // Broadcast atomic group to Algorand
      const { txid } = await algod.sendRawTransaction(signedTxns).do();
      const txId = txid;
      await this.settlementRepo.addLog(settlementId, attempt, 'TX submitted', txId);
      await this.settlementRepo.updateStatus(settlementId, 'CONFIRMING', undefined, txId);

      // Wait for confirmation — use 15 rounds (~60s) to avoid timeout races where
      // the tx confirms but the service hasn't received the response yet.
      const confirmation = await waitForConfirmation(algod, txId, 15);

      await this.settlementRepo.updateStatus(settlementId, 'SETTLED', undefined, txId);
      // algosdk v3 uses camelCase: confirmedRound (bigint). Fall back to hyphen form for compatibility.
      const confirmedRound = Number(confirmation['confirmedRound'] ?? confirmation['confirmed-round'] ?? 0);
      await this.settlementRepo.setConfirmedRound(settlementId, confirmedRound);

      this.logger.log(`Trade settled on-chain: tradeId=${payload.tradeId}, txId=${txId}`);

      // Unfreeze buyer — RWA tokens are defaultFrozen=true, so new opt-ins start frozen.
      // Buyer can receive tokens via clawback while frozen, but can't use them until unfrozen.
      await this.unfreezeBuyer(algod, payload.buyerWalletAddress, payload.asaId);

      await this.emitSettled(payload, usdcAmount, tokenAmount, txId);

    } catch (error: any) {
      const errMsg = error?.message ?? 'Unknown error';
      this.logger.warn(`Settlement attempt ${attempt} failed: ${errMsg}`);
      await this.settlementRepo.addLog(settlementId, attempt, 'Failed', undefined, errMsg);

      // Check if a previously submitted tx actually confirmed (timeout race condition).
      // If the escrow assert fails at pc=432 (isLocked=0), the escrow was already released
      // by an earlier tx that confirmed after our timeout — treat that as SETTLED.
      const isEscrowAlreadyReleased = errMsg.includes('assert failed pc=432') || errMsg.includes('assert failed pc=');
      if (isEscrowAlreadyReleased) {
        const record = await this.settlementRepo.findById(settlementId);
        if (record?.onChainTxId) {
          try {
            const prevTxInfo = await algod.pendingTransactionInformation(record.onChainTxId).do();
            const confirmedRound = prevTxInfo.confirmedRound ?? 0;
            if (confirmedRound > 0) {
              this.logger.log(`Previous TX ${record.onChainTxId} confirmed at round ${confirmedRound} — marking SETTLED`);
              await this.settlementRepo.updateStatus(settlementId, 'SETTLED', undefined, record.onChainTxId);
              await this.settlementRepo.setConfirmedRound(settlementId, Number(confirmedRound));
              await this.emitSettled(payload, usdcAmount, tokenAmount, record.onChainTxId);
              return;
            }
          } catch {
            // tx left pending pool — check indexer
            try {
              const INDEXER = process.env['ALGORAND_INDEXER_SERVER'] ?? 'https://testnet-idx.algonode.cloud';
              const indexer = new algosdk.Indexer('', INDEXER, 443);
              const result = await indexer.lookupTransactionByID(record.onChainTxId).do();
              const confirmedRound = result?.transaction?.['confirmed-round'] ?? result?.transaction?.confirmedRound ?? 0;
              if (confirmedRound > 0) {
                this.logger.log(`Previous TX ${record.onChainTxId} confirmed (indexer) — marking SETTLED`);
                await this.settlementRepo.updateStatus(settlementId, 'SETTLED', undefined, record.onChainTxId);
                await this.settlementRepo.setConfirmedRound(settlementId, Number(confirmedRound));
                await this.emitSettled(payload, usdcAmount, tokenAmount, record.onChainTxId);
                return;
              }
            } catch { /* indexer lookup failed — fall through to retry */ }
          }
        }
        // No prior txId or not confirmed — escrow may have been released via order cancellation.
        // Cannot recover automatically; fail permanently.
        this.logger.error(`Escrow for trade ${payload.tradeId} already released and no confirmed prior tx — marking FAILED`);
        await this.settlementRepo.updateStatus(settlementId, 'FAILED', 'Escrow already released before settlement');
        return;
      }

      // Retry after backoff for transient errors
      const backoffMs = attempt * 2000;
      setTimeout(() => {
        this.attemptSettlement(settlementId, payload, usdcAmount, platformFee, tokenAmount, attempt + 1)
          .catch((e) => this.logger.error('Retry error:', e));
      }, backoffMs);
    }
  }

  private async emitSettled(
    payload: OrderMatchedPayload,
    usdcAmount: bigint,
    tokenAmount: bigint,
    txId: string,
  ): Promise<void> {
    await this.events.emit<TradeSettledPayload>(Topics.TRADE_SETTLED, {
      tradeId: payload.tradeId,
      assetId: payload.assetId,
      asaId: payload.asaId,
      buyerUserId: payload.buyerUserId ?? payload.buyerWalletAddress,
      sellerUserId: payload.sellerUserId ?? payload.sellerWalletAddress,
      price: tokenAmount > 0n ? (usdcAmount / tokenAmount).toString() : '0',
      quantity: tokenAmount.toString(),
      onChainTxId: txId,
      settledAt: new Date().toISOString(),
    });
  }

  private async unfreezeBuyer(
    algod: algosdk.Algodv2,
    buyerAddress: string,
    asaId: number,
  ): Promise<void> {
    try {
      const sp = await algod.getTransactionParams().do();
      const unfreeze = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
        sender: this.adminAccount.addr,
        assetIndex: asaId,
        freezeTarget: buyerAddress,
        frozen: false,
        suggestedParams: sp,
      });
      const signed = unfreeze.signTxn(this.adminAccount.sk);
      const { txid } = await algod.sendRawTransaction(signed).do();
      await waitForConfirmation(algod, txid, 8);
      this.logger.log(`Unfroze buyer ${buyerAddress} for ASA ${asaId} (txId=${txid})`);
    } catch (err) {
      // Non-fatal: tokens delivered but still frozen — buyer can request unfreeze separately
      this.logger.warn(`Failed to unfreeze buyer ${buyerAddress}: ${(err as Error).message}`);
    }
  }
}
