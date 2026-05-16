import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByAssetId(assetId: string) {
    return this.prisma.market.findUnique({ where: { assetId } });
  }

  async findById(id: string) {
    return this.prisma.market.findUnique({ where: { id } });
  }

  async create(data: {
    assetId: string;
    asaId: number;
    ticker: string;
    status: string;
    minimumOrderSize?: bigint;
    tickSize?: bigint;
    referencePriceUsdc?: bigint;
  }) {
    return this.prisma.market.create({ data: data as any });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.market.update({ where: { id }, data: { status: status as any } });
  }

  async triggerCircuitBreaker(id: string, durationMs: number) {
    const until = new Date(Date.now() + durationMs);
    return this.prisma.market.update({
      where: { id },
      data: { circuitBreakerActive: true, circuitBreakerUntil: until },
    });
  }

  async clearCircuitBreaker(id: string) {
    return this.prisma.market.update({
      where: { id },
      data: { circuitBreakerActive: false, circuitBreakerUntil: null },
    });
  }

  async updateReferencePrice(id: string, priceUsdc: bigint) {
    return this.prisma.market.update({
      where: { id },
      data: { referencePriceUsdc: priceUsdc },
    });
  }

  async getOhlcv(assetId: string, interval: string, limit: number) {
    const market = await this.prisma.market.findUnique({ where: { assetId } });
    if (!market) return [];

    // Build OHLCV from Trade records (actual executed trades)
    const trades = await this.prisma.trade.findMany({
      where: { marketId: market.id, status: { in: ['MATCHED', 'SETTLED'] } },
      orderBy: { createdAt: 'asc' },
      select: { price: true, quantity: true, createdAt: true },
    });

    if (trades.length === 0) {
      // No trades yet — return empty array (no synthetic data)
      return [];
    }

    const msPerBucket = this.intervalMs(interval);
    const bucketMap = new Map<number, { o: bigint; h: bigint; l: bigint; c: bigint; v: bigint }>();

    for (const t of trades) {
      const price = t.price;
      const vol = t.quantity;
      const bucket = Math.floor(t.createdAt.getTime() / msPerBucket) * msPerBucket;
      const existing = bucketMap.get(bucket);
      if (!existing) {
        bucketMap.set(bucket, { o: price, h: price, l: price, c: price, v: vol });
      } else {
        existing.h = price > existing.h ? price : existing.h;
        existing.l = price < existing.l ? price : existing.l;
        existing.c = price;
        existing.v += vol;
      }
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .slice(-limit)
      .map(([ts, b]) => ({
        openTime: ts,
        open: b.o.toString(),
        high: b.h.toString(),
        low: b.l.toString(),
        close: b.c.toString(),
        volume: b.v.toString(),
      }));
  }

  private intervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    return map[interval] ?? 3_600_000;
  }

  // Depth snapshot from DB trades — Redis snapshot handled by matching engine
  async getDepthSnapshot(assetId: string, levels: number) {
    const market = await this.prisma.market.findUnique({ where: { assetId } });
    if (!market) return null;

    const [bids, asks] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['price'],
        where: { marketId: market.id, side: 'BUY', status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
        _sum: { remainingQuantity: true },
        orderBy: { price: 'desc' },
        take: levels,
      }),
      this.prisma.order.groupBy({
        by: ['price'],
        where: { marketId: market.id, side: 'SELL', status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
        _sum: { remainingQuantity: true },
        orderBy: { price: 'asc' },
        take: levels,
      }),
    ]);

    return {
      assetId,
      bids: bids.map((b) => ({ price: b.price?.toString(), quantity: b._sum.remainingQuantity?.toString() })),
      asks: asks.map((a) => ({ price: a.price?.toString(), quantity: a._sum.remainingQuantity?.toString() })),
    };
  }
}
