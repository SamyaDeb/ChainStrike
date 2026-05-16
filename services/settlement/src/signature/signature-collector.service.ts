import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import algosdk from 'algosdk';

interface PendingSignature {
  tradeId: string;
  sellerWalletAddress: string;
  unsignedTxnGroup: algosdk.Transaction[];
  resolve: (signed: Uint8Array[] | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// ─────────────────────────────────────────────────────────────────────────────
// SignatureCollectorService
//
// Manages the settlement signature collection flow via WebSocket relay.
//
// Flow:
//   1. SettlementService calls requestSignatures()
//   2. This service serializes the unsigned TX group and forwards it
//      to the Orderbook Service's internal HTTP endpoint
//   3. Orderbook Service relays via Socket.IO to the seller's browser
//   4. Seller signs and sends back via Socket.IO → Orderbook → Settlement internal endpoint
//   5. Settlement internal endpoint calls receiveSignature()
//   6. Promise resolves with signed transactions
//
// Timeout: 30 seconds per signature request.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SignatureCollectorService {
  private readonly logger = new Logger(SignatureCollectorService.name);
  private readonly pending = new Map<string, PendingSignature>();
  private readonly orderbookUrl: string;

  private readonly internalSecret: string;

  constructor() {
    this.orderbookUrl = process.env.ORDERBOOK_SERVICE_URL ?? 'http://localhost:3003';
    this.internalSecret = process.env.INTERNAL_SECRET ?? '';
  }

  // ─── Request signatures from seller via WebSocket ─────────────────────────────

  async requestSignatures(
    tradeId: string,
    unsignedTxnGroup: algosdk.Transaction[],
    sellerWalletAddress: string,
  ): Promise<Uint8Array[] | null> {
    return new Promise((resolve, reject) => {
      // Timeout after 30 seconds
      const timer = setTimeout(() => {
        this.logger.warn(`Signature timeout for trade ${tradeId}`);
        this.pending.delete(tradeId);
        resolve(null);
      }, 30000);

      this.pending.set(tradeId, {
        tradeId,
        sellerWalletAddress,
        unsignedTxnGroup,
        resolve,
        reject,
        timer,
      });

      // Forward to Orderbook Service for WebSocket delivery
      this.forwardToOrderbook(tradeId, unsignedTxnGroup, sellerWalletAddress).catch((err) => {
        this.logger.error(`Failed to forward sign request: ${err.message}`);
        clearTimeout(timer);
        this.pending.delete(tradeId);
        resolve(null);
      });
    });
  }

  // ─── Receive signed transaction back from seller ──────────────────────────────

  receiveSignature(tradeId: string, signedTxnGroupB64: string[]): Uint8Array[] | null {
    const pending = this.pending.get(tradeId);
    if (!pending) {
      this.logger.warn(`Received signature for unknown trade ${tradeId}`);
      return null;
    }

    clearTimeout(pending.timer);
    this.pending.delete(tradeId);

    try {
      const signedTxns = signedTxnGroupB64.map((b64) => new Uint8Array(Buffer.from(b64, 'base64')));
      this.logger.log(`Received signature for trade ${tradeId}`);
      pending.resolve(signedTxns);
      return signedTxns;
    } catch (err) {
      this.logger.error(`Invalid signature data for trade ${tradeId}: ${(err as Error).message}`);
      pending.resolve(null);
      return null;
    }
  }

  // ─── Forward sign request to Orderbook Service via HTTP ───────────────────────

  private async forwardToOrderbook(
    tradeId: string,
    unsignedTxnGroup: algosdk.Transaction[],
    sellerWalletAddress: string,
  ): Promise<void> {
    const unsignedB64 = unsignedTxnGroup.map((txn) =>
      Buffer.from(txn.toByte()).toString('base64'),
    );

    await axios.post(`${this.orderbookUrl}/internal/settlement/forward-sign-request`, {
      tradeId,
      sellerWalletAddress,
      unsignedTxnGroup: unsignedB64,
      expiresAt: Date.now() + 30000,
    }, { headers: { 'x-internal-secret': this.internalSecret } });

    this.logger.debug(`Forwarded sign request to orderbook for trade ${tradeId}`);
  }
}
