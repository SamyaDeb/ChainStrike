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

      const txInfo = await algod.pendingTransactionInformation(escrowTxId).do();

      // Check if transaction is confirmed
      if (!txInfo['confirmed-round']) {
        this.logger.warn(`Escrow TX ${escrowTxId} not yet confirmed`);
        return false;
      }

      // Verify it's an asset transfer (USDC)
      const txn = txInfo['txn'];
      if (txn['type'] !== 'axfer') {
        this.logger.warn(`Escrow TX ${escrowTxId} is not an asset transfer`);
        return false;
      }

      // Verify asset is USDC
      if (txn['xaid'] !== this.usdcAsaId) {
        this.logger.warn(`Escrow TX ${escrowTxId} asset mismatch: ${txn['xaid']} !== ${this.usdcAsaId}`);
        return false;
      }

      // Verify sender is the buyer
      if (txn['snd'] !== expectedBuyerAddress) {
        this.logger.warn(`Escrow TX ${escrowTxId} sender mismatch: ${txn['snd']} !== ${expectedBuyerAddress}`);
        return false;
      }

      // Verify receiver is the escrow contract or admin treasury
      const expectedReceiver = this.escrowContractId
        ? algosdk.getApplicationAddress(this.escrowContractId)
        : process.env['TREASURY_WALLET_ADDRESS'];
      if (!expectedReceiver) {
        this.logger.warn('No escrow contract or treasury address configured');
        return false;
      }
      if (txn['arcv'] !== expectedReceiver) {
        this.logger.warn(`Escrow TX ${escrowTxId} receiver mismatch: ${txn['arcv']} !== ${expectedReceiver}`);
        return false;
      }

      // Verify amount
      const amount = BigInt(txn['aamt'] ?? 0);
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
