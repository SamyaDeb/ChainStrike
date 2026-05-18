import { Controller, Post, Get, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { SettlementService } from '../settlement/settlement.service';

interface SettlePayload {
  tradeId: string;
  assetId: string;
  asaId: number;
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  tokenAmount: string;
  usdcAmount: string;
  platformFee: string;
  price: string;
}

@UseGuards(InternalGuard)
@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly settlementService: SettlementService,
  ) {}

  @Post('settle')
  settle(@Body() payload: SettlePayload) {
    this.logger.log(`Settle request accepted for trade ${payload.tradeId} — processing async`);
    // Fire-and-forget: settlement takes 30–40s (Algorand confirmation) which exceeds the caller's HTTP timeout.
    this.settlementService.processMatch({
      tradeId: payload.tradeId,
      buyOrderId: payload.buyOrderId,
      sellOrderId: payload.sellOrderId,
      assetId: payload.assetId,
      asaId: payload.asaId,
      price: payload.price,
      quantity: payload.tokenAmount,
      buyerWalletAddress: payload.buyerWalletAddress,
      sellerWalletAddress: payload.sellerWalletAddress,
      buyerUserId: payload.buyerUserId,
      sellerUserId: payload.sellerUserId,
    }).catch((err) =>
      this.logger.error(`Background settlement error for trade ${payload.tradeId}: ${(err as Error).message}`),
    );
    return { accepted: true, tradeId: payload.tradeId };
  }

  // ─── Query settlement status by tradeId (used by E2E tests and monitoring) ────

  @Get('settlement/:tradeId')
  async getSettlement(@Param('tradeId') tradeId: string) {
    return this.settlementService.findByTradeId(tradeId);
  }

}
