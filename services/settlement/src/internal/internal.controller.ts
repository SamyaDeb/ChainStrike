import { Controller, Post, Body, Logger } from '@nestjs/common';
import { SignatureCollectorService } from '../signature/signature-collector.service';

interface SignResponsePayload {
  tradeId: string;
  signedTxnGroup: string[]; // base64 encoded
  sellerWalletAddress: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Controller — HTTP endpoints called by other services
//
//   POST /internal/settlement/signature-response
//     Called by Orderbook Service when seller signs a transaction via WebSocket.
// ─────────────────────────────────────────────────────────────────────────────

@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly collector: SignatureCollectorService) {}

  @Post('settlement/signature-response')
  async receiveSignature(@Body() payload: SignResponsePayload) {
    this.logger.log(`Received signature response for trade ${payload.tradeId}`);
    const result = this.collector.receiveSignature(payload.tradeId, payload.signedTxnGroup);
    return {
      success: !!result,
      tradeId: payload.tradeId,
    };
  }
}
