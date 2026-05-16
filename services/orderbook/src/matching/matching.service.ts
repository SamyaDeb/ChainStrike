import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InMemoryOrderBookStore, BookEntry } from '../orderbook/in-memory-order-book.store';
import { OrderbookGateway } from '../gateway/orderbook.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { Mutex } from 'async-mutex';

export interface MatchResult {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  assetId: string;
  asaId: number;
  marketId: string;
  price: bigint;
  quantity: bigint;
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  buyerUserId: string;
  sellerUserId: string;
  buyNewRemaining: bigint;
  sellNewRemaining: bigint;
}

@Injectable()
export class MatchingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MatchingService.name);
  private readonly settlementServiceUrl: string;
  private readonly feeRate = 0.0025;
  private readonly assetLocks = new Map<string, Mutex>();

  constructor(
    private readonly bookStore: InMemoryOrderBookStore,
    private readonly gateway: OrderbookGateway,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.settlementServiceUrl = this.config.get<string>(
      'SETTLEMENT_SERVICE_URL',
      'http://localhost:3005',
    );
  }

  private getLock(assetId: string): Mutex {
    if (!this.assetLocks.has(assetId)) {
      this.assetLocks.set(assetId, new Mutex());
    }
    return this.assetLocks.get(assetId)!;
  }

  // ─── Hydrate in-memory book from DB on startup ───────────────────────────────
  async onApplicationBootstrap() {
    try {
      const markets = await this.prisma.market.findMany({
        where: { status: 'ACTIVE' },
        include: {
          orders: {
            where: { status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
          },
        },
      });

      let count = 0;
      for (const market of markets) {
        for (const order of market.orders) {
          this.bookStore.addOrder({
            orderId: order.id,
            userId: order.userId,
            assetId: market.assetId,
            asaId: market.asaId,
            marketId: market.id,
            side: order.side.toLowerCase() as 'buy' | 'sell',
            type: order.type.toLowerCase() as 'limit' | 'market',
            timeInForce: (order.timeInForce ?? 'GTC') as 'GTC' | 'IOC' | 'FOK',
            price: order.price ?? undefined,
            quantity: order.quantity,
            remainingQuantity: order.remainingQuantity,
            walletAddress: order.walletAddress,
            timestamp: order.createdAt.getTime(),
          });
          count++;
        }
      }
      this.logger.log(`Order book hydrated from DB: ${count} active order(s) across ${markets.length} market(s)`);
    } catch (err) {
      this.logger.error(`Failed to hydrate order book: ${(err as Error).message}`);
    }
  }

  // ─── Process incoming order: add to book, match, persist, settle ─────────────
  async processOrder(entry: BookEntry): Promise<MatchResult[]> {
    // Use per-asset lock to prevent double-fills
    const release = await this.getLock(entry.assetId).acquire();
    try {
      this.bookStore.addOrder(entry);

      const matches = await this.match(entry);

      const depth = this.bookStore.getDepth(entry.assetId, 20);
      this.gateway.broadcastOrderbookUpdate(entry.assetId, depth);

      for (const match of matches) {
        const totalValue = match.price * match.quantity / 1_000_000n;
        const platformFee = BigInt(Math.floor(Number(totalValue) * this.feeRate));

        // Persist trade record + update order statuses — settlement callback needs this
        try {
          // Wrap all DB writes in a transaction
          await this.prisma.$transaction([
            this.prisma.trade.create({
              data: {
                id: match.tradeId,
                marketId: match.marketId,
                buyOrderId: match.buyOrderId,
                sellOrderId: match.sellOrderId,
                buyerUserId: match.buyerUserId,
                sellerUserId: match.sellerUserId,
                buyerWalletAddress: match.buyerWalletAddress,
                sellerWalletAddress: match.sellerWalletAddress,
                price: match.price,
                quantity: match.quantity,
                totalValue,
                platformFee,
                feeRate: this.feeRate,
                status: 'MATCHED',
              } as any,
            }),
            this.prisma.order.update({
              where: { id: match.buyOrderId },
              data: {
                remainingQuantity: match.buyNewRemaining,
                filledQuantity: { increment: match.quantity },
                status: match.buyNewRemaining <= 0n ? 'FILLED' : 'PARTIALLY_FILLED',
              } as any,
            }),
            this.prisma.order.update({
              where: { id: match.sellOrderId },
              data: {
                remainingQuantity: match.sellNewRemaining,
                filledQuantity: { increment: match.quantity },
                status: match.sellNewRemaining <= 0n ? 'FILLED' : 'PARTIALLY_FILLED',
              } as any,
            }),
            this.prisma.market.update({
              where: { id: match.marketId },
              data: { lastTradedPrice: match.price } as any,
            }),
          ]);
        } catch (dbErr) {
          this.logger.error(`DB write failed for trade ${match.tradeId}: ${(dbErr as Error).message}`);
        }

        // Call settlement service (fire: it responds immediately now and processes async)
        try {
          await axios.post(`${this.settlementServiceUrl}/internal/settle`, {
            tradeId: match.tradeId,
            assetId: match.assetId,
            asaId: match.asaId,
            buyOrderId: match.buyOrderId,
            sellOrderId: match.sellOrderId,
            buyerUserId: match.buyerUserId,
            sellerUserId: match.sellerUserId,
            buyerWalletAddress: match.buyerWalletAddress,
            sellerWalletAddress: match.sellerWalletAddress,
            tokenAmount: match.quantity.toString(),
            usdcAmount: totalValue.toString(),
            platformFee: platformFee.toString(),
            price: match.price.toString(),
          }, { timeout: 5000 });

          this.gateway.broadcastTrade(entry.assetId, {
            price: match.price.toString(),
            quantity: match.quantity.toString(),
            side: entry.side === 'buy' ? 'BUY' : 'SELL',
            timestamp: new Date().toISOString(),
          });

          this.logger.log(
            `Trade matched + settlement triggered: ${match.tradeId} | ${match.quantity} @ ${match.price} | buy=${match.buyOrderId} sell=${match.sellOrderId}`,
          );
        } catch (err) {
          this.logger.error(`Settlement call failed for trade ${match.tradeId}: ${(err as Error).message}`);
        }
      }

      return matches;
    } finally {
      release();
    }
  }

  private async match(incoming: BookEntry): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];

    while (true) {
      const best = this.bookStore.getBestOpposing(incoming.assetId, incoming.side);
      if (!best) break;
      if (!this.pricesCross(incoming, best)) break;

      const incomingEntry = this.bookStore.getEntry(incoming.assetId, incoming.side, incoming.orderId);
      if (!incomingEntry || incomingEntry.remainingQuantity <= 0n) break;

      const fillQty = incomingEntry.remainingQuantity < best.remainingQuantity
        ? incomingEntry.remainingQuantity
        : best.remainingQuantity;

      const executionPrice = best.price ?? incoming.price!;
      const oppSide = incoming.side === 'buy' ? 'sell' : 'buy';

      // Reduce in-memory quantities (mutates entries in place)
      this.bookStore.reduceQuantity(incoming.assetId, incoming.side, incoming.orderId, fillQty);
      this.bookStore.reduceQuantity(incoming.assetId, oppSide, best.orderId, fillQty);

      // Capture remaining quantities after reduce (for DB write)
      const buyNewRemaining = incoming.side === 'buy' ? incomingEntry.remainingQuantity : best.remainingQuantity;
      const sellNewRemaining = incoming.side === 'sell' ? incomingEntry.remainingQuantity : best.remainingQuantity;

      if (best.remainingQuantity <= 0n) {
        this.bookStore.removeOrder(incoming.assetId, oppSide, best.orderId);
      }

      matches.push({
        tradeId: randomUUID(),
        buyOrderId: incoming.side === 'buy' ? incoming.orderId : best.orderId,
        sellOrderId: incoming.side === 'sell' ? incoming.orderId : best.orderId,
        assetId: incoming.assetId,
        asaId: incoming.asaId,
        marketId: incoming.marketId,
        price: executionPrice,
        quantity: fillQty,
        buyerWalletAddress: incoming.side === 'buy' ? incoming.walletAddress : best.walletAddress,
        sellerWalletAddress: incoming.side === 'sell' ? incoming.walletAddress : best.walletAddress,
        buyerUserId: incoming.side === 'buy' ? incoming.userId : best.userId,
        sellerUserId: incoming.side === 'sell' ? incoming.userId : best.userId,
        buyNewRemaining,
        sellNewRemaining,
      });
    }

    // IOC/FOK: cancel unfilled remainder
    const incomingEntry = this.bookStore.getEntry(incoming.assetId, incoming.side, incoming.orderId);
    if (incomingEntry && incomingEntry.remainingQuantity > 0n) {
      if (incoming.timeInForce === 'IOC') {
        // IOC: cancel unfilled remainder
        this.bookStore.removeOrder(incoming.assetId, incoming.side, incoming.orderId);
      } else if (incoming.timeInForce === 'FOK') {
        // FOK: if not fully filled, cancel and rollback all partial fills
        this.bookStore.removeOrder(incoming.assetId, incoming.side, incoming.orderId);
        // Restore quantities for all resting orders that were partially consumed
        for (const match of matches) {
          const oppSide = incoming.side === 'buy' ? 'sell' : 'buy';
          this.bookStore.restoreQuantity(incoming.assetId, oppSide, match.sellOrderId, match.quantity);
        }
        // Return empty matches — order is cancelled
        return [];
      }
    }

    return matches;
  }

  cancelOrder(assetId: string, orderId: string): void {
    this.bookStore.removeOrderBothSides(assetId, orderId);
    const depth = this.bookStore.getDepth(assetId, 20);
    this.gateway.broadcastOrderbookUpdate(assetId, { assetId, ...depth });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryOrphanedSettlements(): Promise<void> {
    const cutoff = new Date(Date.now() - 30_000); // 30s old
    const orphaned = await this.prisma.trade.findMany({
      where: {
        status: 'MATCHED',
        createdAt: { lt: cutoff },
        settlementAttempts: { lt: 5 },
      },
    });

    for (const trade of orphaned) {
      try {
        await this.prisma.trade.update({
          where: { id: trade.id },
          data: { settlementAttempts: { increment: 1 } },
        });
        await axios.post(`${this.settlementServiceUrl}/internal/settle`, {
          tradeId: trade.id,
          assetId: trade.assetId,
          buyOrderId: trade.buyOrderId,
          sellOrderId: trade.sellOrderId,
          price: trade.price.toString(),
          quantity: trade.quantity.toString(),
        }, { timeout: 5000 });
      } catch (err) {
        this.logger.warn(`Settlement retry failed for trade ${trade.id}: ${(err as Error).message}`);
      }
    }
  }

  private pricesCross(incoming: BookEntry, opposing: BookEntry): boolean {
    if (incoming.type === 'market') return true;
    if (!incoming.price || !opposing.price) return true;
    return incoming.side === 'buy'
      ? incoming.price >= opposing.price
      : incoming.price <= opposing.price;
  }
}
