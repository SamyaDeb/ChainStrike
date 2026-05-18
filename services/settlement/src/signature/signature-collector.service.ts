import { Injectable, Logger } from '@nestjs/common';
import algosdk from 'algosdk';

interface PendingSignature {
  tradeId: string;
  sellerWalletAddress: string;
  unsignedTxnGroup: algosdk.Transaction[];
  resolve: (signed: Uint8Array[] | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class SignatureCollectorService {
  private readonly logger = new Logger(SignatureCollectorService.name);
  private readonly pending = new Map<string, PendingSignature>();
  private readonly internalSecret: string;

  constructor() {
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

      this.logger.warn(`requestSignatures called for trade ${tradeId} — no relay target configured`);
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

}
