import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketRepository } from './market.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConstants } from '@chainstrike/config';

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly marketRepo: MarketRepository,
    private readonly prisma: PrismaService,
  ) {}

  async openMarket(assetId: string, asaId: number, ticker: string, referencePriceUsdc?: bigint) {
    return this.marketRepo.create({
      assetId,
      asaId,
      ticker,
      status: 'PRE_MARKET',
      ...(referencePriceUsdc !== undefined ? { referencePriceUsdc } : {}),
    });
  }

  async activateMarket(assetId: string) {
    const market = await this.marketRepo.findByAssetId(assetId);
    if (!market) throw new Error(`No market for asset ${assetId}`);
    return this.marketRepo.updateStatus(market.id, 'ACTIVE');
  }

  async checkCircuitBreakers() {
    const markets = await this.prisma.market.findMany({
      where: { status: 'ACTIVE', circuitBreakerActive: false },
    });

    for (const market of markets) {
      await this.evaluateCircuitBreaker(market.id, market.assetId);
    }
  }

  private async evaluateCircuitBreaker(marketId: string, assetId: string) {
    // Look at last N minutes of trades for price movement
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const trades = await this.prisma.trade.findMany({
      where: { marketId, matchedAt: { gte: since } },
      orderBy: { matchedAt: 'asc' },
      select: { price: true },
    });

    if (trades.length < 2) return;

    const firstPrice = BigInt(trades[0].price);
    const lastPrice = BigInt(trades[trades.length - 1].price);
    const pctChange = Number(((lastPrice - firstPrice) * 10000n) / firstPrice) / 100;

    if (Math.abs(pctChange) > PlatformConstants.CIRCUIT_BREAKER_PCT * 100) {
      await this.marketRepo.triggerCircuitBreaker(marketId, 15 * 60 * 1000); // 15 min halt
      this.logger.warn(`Circuit breaker triggered for market ${marketId}: ${pctChange.toFixed(2)}% move in 5 min`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async clearExpiredCircuitBreakers() {
    const now = new Date();
    await this.prisma.market.updateMany({
      where: { circuitBreakerActive: true, circuitBreakerUntil: { lt: now } },
      data: { circuitBreakerActive: false },
    });
  }
}
