import { Injectable, Logger } from '@nestjs/common';
import algosdk from 'algosdk';
import { getAlgodClient } from '@chainstrike/algorand';
import { algorandConfig } from '@chainstrike/config';

// ─────────────────────────────────────────────────────────────────────────────
// EscrowService
//
// Manages escrow operations for buy orders:
//   - Verify USDC lock transaction on-chain
//   - Call recordLock on escrow contract (admin-signed) — optional for testnet
//   - Call returnToBuyer on order cancellation — optional for testnet
//
// For testnet: if ESCROW_CONTRACT_APP_ID is not set, logs warnings but continues.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private readonly algoCfg = algorandConfig();
  private readonly adminAccount: algosdk.Account;
  private readonly escrowContractId: number;
  private readonly usdcAsaId: number;

  constructor() {
    const mnemonic = process.env['ALGORAND_ADMIN_MNEMONIC'];
    if (!mnemonic) {
      throw new Error('ALGORAND_ADMIN_MNEMONIC is required');
    }
    this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
    this.escrowContractId = parseInt(process.env['ESCROW_CONTRACT_APP_ID'] ?? '0', 10);
    this.usdcAsaId = this.algoCfg.usdcAssetId;
  }

  // ─── Verify a USDC lock transaction on-chain ──────────────────────────────────
  // Returns true if the buyer sent USDC to the escrow contract address.

  async verifyEscrowLock(
    escrowTxId: string,
    expectedBuyerAddress: string,
    expectedAmount: bigint,
  ): Promise<boolean> {
    try {
      const algod = getAlgodClient({
        host: this.algoCfg.algodHost,
        port: this.algoCfg.algodPort,
        token: this.algoCfg.algodToken,
        network: this.algoCfg.network,
      });

      // Try pending pool first (works within ~5 minutes of confirmation),
      // then fall back to indexer for older confirmed transactions.
      let txn: any;
      try {
        const txInfo = await algod.pendingTransactionInformation(escrowTxId).do();
        if (!txInfo.confirmedRound) {
          this.logger.warn(`Escrow TX ${escrowTxId} not yet confirmed`);
          return false;
        }
        txn = txInfo.txn.txn;
      } catch {
        // Tx left the pending pool — look it up via indexer
        const INDEXER = process.env['ALGORAND_INDEXER_SERVER'] ?? 'https://testnet-idx.algonode.cloud';
        const indexer = new algosdk.Indexer('', INDEXER, 443);
        const result = await indexer.lookupTransactionByID(escrowTxId).do();
        const raw = result.transaction as any;
        // algosdk v3 indexer returns camelCase field names
        const xferRaw = raw.assetTransferTransaction ?? raw['asset-transfer-transaction'];
        txn = {
          type: raw.txType ?? raw['tx-type'],
          sender: raw.sender,
          assetTransfer: xferRaw
            ? {
                assetIndex: Number(xferRaw.assetId ?? xferRaw['asset-id']),
                amount: BigInt(xferRaw.amount ?? 0),
                receiver: xferRaw.receiver,
              }
            : undefined,
        };
      }

      // Verify it's an asset transfer (USDC) — TransactionType enum
      if (txn.type !== 'axfer') {
        this.logger.warn(`Escrow TX ${escrowTxId} is not an asset transfer (type=${txn.type})`);
        return false;
      }

      // txn.assetTransfer holds the asset-transfer-specific fields
      const xfer = txn.assetTransfer;
      if (!xfer) {
        this.logger.warn(`Escrow TX ${escrowTxId} missing assetTransfer fields`);
        return false;
      }

      // Verify asset is USDC (assetIndex is bigint in v3)
      if (Number(xfer.assetIndex) !== this.usdcAsaId) {
        this.logger.warn(`Escrow TX ${escrowTxId} asset mismatch: ${xfer.assetIndex} !== ${this.usdcAsaId}`);
        return false;
      }

      // Verify sender is the buyer
      const senderStr = typeof txn.sender === 'string' ? txn.sender : txn.sender.toString();
      if (senderStr !== expectedBuyerAddress) {
        this.logger.warn(`Escrow TX ${escrowTxId} sender mismatch: ${senderStr} !== ${expectedBuyerAddress}`);
        return false;
      }

      // Verify receiver is the escrow contract or treasury wallet
      const expectedReceiver = this.escrowContractId
        ? algosdk.getApplicationAddress(this.escrowContractId).toString()
        : process.env['TREASURY_WALLET_ADDRESS'];
      if (!expectedReceiver) {
        this.logger.warn('No escrow contract or treasury address configured');
        return false;
      }
      const receiverStr = typeof xfer.receiver === 'string' ? xfer.receiver : xfer.receiver.toString();
      if (receiverStr !== expectedReceiver) {
        this.logger.warn(`Escrow TX ${escrowTxId} receiver mismatch: ${receiverStr} !== ${expectedReceiver}`);
        return false;
      }

      // Verify amount (bigint in v3)
      const amount = xfer.amount ?? 0n;
      if (amount < expectedAmount) {
        this.logger.warn(`Escrow TX ${escrowTxId} amount too low: ${amount} < ${expectedAmount}`);
        return false;
      }

      this.logger.log(`Escrow verified: ${escrowTxId}, buyer=${expectedBuyerAddress}, amount=${amount}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to verify escrow TX ${escrowTxId}: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Record lock on escrow contract (admin-signed) ────────────────────────────
  // Called after verifying the buyer's USDC transfer. Optional for testnet.

  async recordEscrowLock(
    orderId: string,
    buyerAddress: string,
    amount: bigint,
  ): Promise<string | null> {
    if (!this.escrowContractId) {
      this.logger.warn(`Escrow contract not deployed, skipping recordLock for order ${orderId}`);
      return null;
    }

    try {
      const algod = getAlgodClient({
        host: this.algoCfg.algodHost,
        port: this.algoCfg.algodPort,
        token: this.algoCfg.algodToken,
        network: this.algoCfg.network,
      });

      const suggestedParams = await algod.getTransactionParams().do();

      const appCall = algosdk.makeApplicationNoOpTxnFromObject({
        sender: this.adminAccount.addr,
        appIndex: this.escrowContractId,
        appArgs: [
          new TextEncoder().encode('record_lock'),
          new TextEncoder().encode(orderId),
          new TextEncoder().encode(buyerAddress),
          algosdk.encodeUint64(Number(amount)),
        ],
        suggestedParams,
      });

      const signed = appCall.signTxn(this.adminAccount.sk);
      const { txid } = await algod.sendRawTransaction(signed).do();
      const txId = txid;

      this.logger.log(`Escrow lock recorded: orderId=${orderId}, txId=${txId}`);
      return txId;
    } catch (err) {
      this.logger.error(`Failed to record escrow lock: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Return USDC to buyer on order cancellation ──────────────────────────────
  // Optional for testnet.

  async returnToBuyer(orderId: string): Promise<string | null> {
    if (!this.escrowContractId) {
      this.logger.warn(`Escrow contract not deployed, skipping returnToBuyer for order ${orderId}`);
      return null;
    }

    try {
      const algod = getAlgodClient({
        host: this.algoCfg.algodHost,
        port: this.algoCfg.algodPort,
        token: this.algoCfg.algodToken,
        network: this.algoCfg.network,
      });

      const suggestedParams = await algod.getTransactionParams().do();

      const appCall = algosdk.makeApplicationNoOpTxnFromObject({
        sender: this.adminAccount.addr,
        appIndex: this.escrowContractId,
        appArgs: [
          new TextEncoder().encode('return_to_buyer'),
          new TextEncoder().encode(orderId),
        ],
        suggestedParams,
      });

      const signed = appCall.signTxn(this.adminAccount.sk);
      const { txid } = await algod.sendRawTransaction(signed).do();
      const txId = txid;

      this.logger.log(`Escrow returned to buyer: orderId=${orderId}, txId=${txId}`);
      return txId;
    } catch (err) {
      this.logger.error(`Failed to return escrow: ${(err as Error).message}`);
      return null;
    }
  }
}
