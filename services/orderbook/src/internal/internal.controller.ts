import { Controller, Post, Body, Logger } from '@nestjs/common';
import { OrderbookGateway } from '../gateway/orderbook.gateway';

interface SignRequestPayload {
  tradeId: string;
  sellerWalletAddress: string;
  unsignedTxnGroup: string[];
  expiresAt: number; // Unix timestamp ms
}

interface SignResponsePayload {
  tradeId: string;
  signedTxnGroup: string[];
  sellerWalletAddress: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Controller — HTTP endpoints called by other services
//
// These endpoints are NOT exposed through the API Gateway.
// They are for inter-service communication only.
// ─────────────────────────────────────────────────────────────────────────────

@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly gateway: OrderbookGateway) {}

  @Post('settlement/forward-sign-request')
  async forwardSignRequest(@Body() payload: SignRequestPayload) {
    const connected = await this.gateway.getWalletConnectionCount(payload.sellerWalletAddress);
    if (connected === 0) {
      this.logger.warn(`No WebSocket connection for ${payload.sellerWalletAddress}`);
      return { success: false, error: 'Seller not connected' };
    }

    this.gateway.forwardSettlementSignRequest(payload.sellerWalletAddress, {
      tradeId: payload.tradeId,
      unsignedTxnGroup: payload.unsignedTxnGroup,
      expiresAt: payload.expiresAt,
    });

    return { success: true, message: 'Sign request forwarded' };
  }
}
