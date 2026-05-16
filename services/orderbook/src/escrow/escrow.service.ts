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

      // Normalised txn fields extracted from either pending-pool or indexer response.
      let type: string | undefined;
      let senderStr: string | undefined;
      let assetIndex: number | undefined;
      let amount: bigint | undefined;
      let receiverStr: string | undefined;

      // Helper: decode an address field that may be a string, Uint8Array, or Address object
      const addrToStr = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (v instanceof Uint8Array) return algosdk.encodeAddress(v);
        if (typeof v.toString === 'function') {
          const s = v.toString();
          // If it looks like an Algorand address (58 chars, base32), trust it
          if (/^[A-Z2-7]{58}$/.test(s)) return s;
        }
        // Last resort: try encoding as address public key
        try { return algosdk.encodeAddress(v); } catch { return String(v); }
      };

      try {
        // Pending pool — works within ~5 minutes after confirmation.
        // algosdk v3 decodes the response as raw msgpack fields (short names):
        //   type='axfer', snd=Uint8Array, xaid=number, aamt=bigint, arcv=Uint8Array
        const txInfo = await algod.pendingTransactionInformation(escrowTxId).do();
        if (!txInfo.confirmedRound) {
          this.logger.warn(`Escrow TX ${escrowTxId} not yet confirmed`);
          return false;
        }
        const raw = txInfo.txn?.txn as any;
        // algosdk v3 may return either short msgpack names OR decoded Transaction properties
        type = raw?.type ?? raw?.['type'];
        senderStr = addrToStr(raw?.snd ?? raw?.sender);
        // Asset transfer fields
        const xaid = raw?.xaid ?? raw?.assetTransfer?.assetIndex ?? raw?.['xaid'];
        const aamt = raw?.aamt ?? raw?.assetTransfer?.amount ?? raw?.['aamt'];
        const arcv = raw?.arcv ?? raw?.assetTransfer?.receiver ?? raw?.['arcv'];
        assetIndex = xaid !== undefined ? Number(xaid) : undefined;
        amount = aamt !== undefined ? BigInt(aamt) : undefined;
        receiverStr = addrToStr(arcv);
        this.logger.debug(`Pending pool TX ${escrowTxId}: type=${type} snd=${senderStr} xaid=${assetIndex} aamt=${amount} arcv=${receiverStr}`);
      } catch {
        // Tx left the pending pool — fall back to indexer
        this.logger.debug(`TX ${escrowTxId} not in pending pool, falling back to indexer`);
        const INDEXER = process.env['ALGORAND_INDEXER_SERVER'] ?? 'https://testnet-idx.algonode.cloud';
        const indexer = new algosdk.Indexer('', INDEXER, 443);
        const result = await indexer.lookupTransactionByID(escrowTxId).do();
        const raw = result.transaction as any;
        // Indexer uses camelCase: assetTransferTransaction or asset-transfer-transaction
        const xferRaw = raw?.assetTransferTransaction ?? raw?.['asset-transfer-transaction'];
        type = raw?.txType ?? raw?.['tx-type'];
        senderStr = addrToStr(raw?.sender);
        assetIndex = xferRaw ? Number(xferRaw.assetId ?? xferRaw['asset-id']) : undefined;
        amount = xferRaw ? BigInt(xferRaw.amount ?? 0) : undefined;
        receiverStr = addrToStr(xferRaw?.receiver);
        this.logger.debug(`Indexer TX ${escrowTxId}: type=${type} snd=${senderStr} xaid=${assetIndex} aamt=${amount} arcv=${receiverStr}`);
      }

      // Verify it's an asset transfer
      if (type !== 'axfer') {
        this.logger.warn(`Escrow TX ${escrowTxId} is not an asset transfer (type=${type})`);
        return false;
      }

      if (assetIndex === undefined || amount === undefined || !receiverStr) {
        this.logger.warn(`Escrow TX ${escrowTxId} missing asset transfer fields`);
        return false;
      }

      // Verify asset is USDC
      if (assetIndex !== this.usdcAsaId) {
        this.logger.warn(`Escrow TX ${escrowTxId} asset mismatch: ${assetIndex} !== ${this.usdcAsaId}`);
        return false;
      }

      // Verify sender is the buyer
      if (senderStr !== expectedBuyerAddress) {
        this.logger.warn(`Escrow TX ${escrowTxId} sender mismatch: ${senderStr} !== ${expectedBuyerAddress}`);
        return false;
      }

      // Verify receiver is the escrow contract address
      const expectedReceiver = this.escrowContractId
        ? algosdk.getApplicationAddress(this.escrowContractId).toString()
        : process.env['TREASURY_WALLET_ADDRESS'];
      if (!expectedReceiver) {
        this.logger.warn('No escrow contract configured (ESCROW_CONTRACT_APP_ID not set)');
        return false;
      }
      if (receiverStr !== expectedReceiver) {
        this.logger.warn(`Escrow TX ${escrowTxId} receiver mismatch: ${receiverStr} !== ${expectedReceiver}`);
        return false;
      }

      // Verify amount
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

  // ─── Record lock on escrow contract (admin-signed, ARC-4 ABI call) ───────────
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

      // Box key: keyPrefix 'e:' + orderId bytes (as defined in EscrowContract BoxMap)
      const enc = new TextEncoder();
      const boxKey = new Uint8Array([...enc.encode('e:'), ...enc.encode(orderId)]);

      // ARC-4 ABI call: recordLock(byte[],address,uint64)void
      const atc = new algosdk.AtomicTransactionComposer();
      atc.addMethodCall({
        appID: this.escrowContractId,
        method: algosdk.ABIMethod.fromSignature('recordLock(byte[],address,uint64)void'),
        methodArgs: [
          enc.encode(orderId), // orderId: byte[]
          buyerAddress,        // buyerAddress: address
          amount,              // amount: uint64
        ],
        sender: this.adminAccount.addr.toString(),
        signer: algosdk.makeBasicAccountTransactionSigner(this.adminAccount),
        suggestedParams,
        boxes: [{ appIndex: 0, name: boxKey }],
      });

      const result = await atc.execute(algod, 4);
      const txId = result.txIDs[0];

      this.logger.log(`Escrow lock recorded: orderId=${orderId}, txId=${txId}`);
      return txId;
    } catch (err) {
      this.logger.error(`Failed to record escrow lock: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Return USDC to buyer on order cancellation (ARC-4 ABI call) ─────────────
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

      const enc2 = new TextEncoder();
      const boxKey2 = new Uint8Array([...enc2.encode('e:'), ...enc2.encode(orderId)]);

      // ARC-4 ABI call: returnToBuyer(byte[])void — escrow issues 1 inner USDC transfer
      const atc = new algosdk.AtomicTransactionComposer();
      atc.addMethodCall({
        appID: this.escrowContractId,
        method: algosdk.ABIMethod.fromSignature('returnToBuyer(byte[])void'),
        methodArgs: [
          enc2.encode(orderId), // orderId: byte[]
        ],
        sender: this.adminAccount.addr.toString(),
        signer: algosdk.makeBasicAccountTransactionSigner(this.adminAccount),
        suggestedParams: { ...suggestedParams, fee: 2000n, flatFee: true },
        appForeignAssets: [this.usdcAsaId],
        boxes: [{ appIndex: 0, name: boxKey2 }],
      });

      const result = await atc.execute(algod, 4);
      const txId = result.txIDs[0];

      this.logger.log(`Escrow returned to buyer: orderId=${orderId}, txId=${txId}`);
      return txId;
    } catch (err) {
      this.logger.error(`Failed to return escrow: ${(err as Error).message}`);
      return null;
    }
  }
}
