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

    const refPrice = Number(market.referencePriceUsdc ?? 10_000_000n);

    // Build OHLCV from settled trades; fall back to synthetic candles when no trades yet
    const trades = await this.prisma.order.findMany({
      where: { marketId: market.id, status: 'FILLED' },
      orderBy: { createdAt: 'asc' },
      select: { price: true, filledQuantity: true, createdAt: true },
    });

    if (trades.length === 0) {
      // Return synthetic flat candles so the chart renders
      const buckets = [];
      for (let i = limit - 1; i >= 0; i--) {
        const ts = Date.now() - i * this.intervalMs(interval);
        const jitter = (Math.random() - 0.5) * refPrice * 0.02;
        const p = (refPrice + jitter).toFixed(0);
        buckets.push({ t: ts, o: p, h: p, l: p, c: p, v: '0' });
      }
      return buckets;
    }

    const msPerBucket = this.intervalMs(interval);
    const bucketMap = new Map<number, { o: bigint; h: bigint; l: bigint; c: bigint; v: bigint }>();

    for (const t of trades) {
      const price = t.price ?? 0n;
      const vol = t.filledQuantity ?? 0n;
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
        t: ts, o: b.o.toString(), h: b.h.toString(), l: b.l.toString(), c: b.c.toString(), v: b.v.toString(),
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
