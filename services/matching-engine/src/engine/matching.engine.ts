import { Injectable, Logger } from '@nestjs/common';
import { OrderBookStore } from '../book/order-book.store';
import { EventProducerService } from '../events/event-producer.service';
import { Topics } from '@chainstrike/events';
import { OrderPlacedPayload, OrderMatchedPayload } from '@chainstrike/types';
import { randomUUID } from 'crypto';
import { FeeSchedule, PlatformConstants } from '@chainstrike/config';

// ─────────────────────────────────────────────────────────────────────────────
// Matching Engine — Central Limit Order Book (CLOB)
//
// Algorithm: Price-Time Priority
//   - Best price gets priority (lowest ask for buys, highest bid for sells)
//   - Among orders at the same price: earliest time wins
//
// Order book state lives in Redis (OrderBookStore) for sub-millisecond access.
// Matched trade instructions are emitted to Settlement Service via Kafka.
//
// This service is stateless — it reads from Redis and emits events.
// Redis is the source of truth for book state.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingOrder {
  orderId: string;
  userId: string;
  assetId: string;
  asaId: number;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  price?: bigint;
  quantity: bigint;
  remainingQuantity: bigint;
  walletAddress: string;
  timestamp: number;
}

export interface MatchResult {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  assetId: string;
  asaId: number;
  price: bigint;
  quantity: bigint;  // Matched quantity
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  buyerUserId: string;
  sellerUserId: string;
}

@Injectable()
export class MatchingEngine {
  private readonly logger = new Logger(MatchingEngine.name);

  constructor(
    private readonly bookStore: OrderBookStore,
    private readonly events: EventProducerService,
  ) {}

  // ─── Process incoming order ───────────────────────────────────────────────────
  // Called when ORDER_PLACED event is received from Orderbook Service.

  async processOrder(order: PendingOrder): Promise<void> {
    const startTime = Date.now();

    // Add order to book
    await this.bookStore.addOrder(order);

    // Attempt matching
    const matches = await this.match(order);

    const elapsed = Date.now() - startTime;
    this.logger.debug(
      `Processed order ${order.orderId}: ${matches.length} match(es) in ${elapsed}ms`,
    );

    // Emit each match to Settlement Service
    for (const match of matches) {
      await this.events.emit<OrderMatchedPayload>(Topics.ORDER_MATCHED, {
        tradeId: match.tradeId,
        buyOrderId: match.buyOrderId,
        sellOrderId: match.sellOrderId,
        assetId: match.assetId,
        asaId: match.asaId,
        price: match.price.toString(),
        quantity: match.quantity.toString(),
        buyerWalletAddress: match.buyerWalletAddress,
        sellerWalletAddress: match.sellerWalletAddress,
      });

      // Emit partial fill events for the orderbook service to update order states
      await this.events.emit(Topics.ORDER_PARTIALLY_FILLED, {
        orderId: match.buyOrderId,
        filledQuantity: match.quantity.toString(),
        executionPrice: match.price.toString(),
      });
    }

    // Handle IOC/FOK: cancel unfilled remainder
    if (order.timeInForce === 'IOC' || order.timeInForce === 'FOK') {
      const remaining = await this.bookStore.getRemainingQuantity(order.assetId, order.orderId, order.side);
      if (remaining > 0n) {
        if (order.timeInForce === 'FOK' && matches.length === 0) {
          // FOK: no fill at all — cancel
          await this.bookStore.removeOrder(order.assetId, order.orderId, order.side);
          await this.events.emit(Topics.ORDER_CANCELLED, {
            orderId: order.orderId,
            userId: order.userId,
            reason: 'FOK order could not be fully filled',
          });
        } else if (order.timeInForce === 'IOC') {
          // IOC: cancel unfilled remainder
          await this.bookStore.removeOrder(order.assetId, order.orderId, order.side);
          await this.events.emit(Topics.ORDER_CANCELLED, {
            orderId: order.orderId,
            userId: order.userId,
            reason: 'IOC order: unfilled remainder cancelled',
          });
        }
      }
    }
  }

  // ─── Core matching logic ──────────────────────────────────────────────────────

  private async match(incomingOrder: PendingOrder): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];
    const oppositeSide = incomingOrder.side === 'buy' ? 'sell' : 'buy';

    while (true) {
      // Get the best opposing order from Redis
      const bestOpposing = await this.bookStore.getBestOrder(
        incomingOrder.assetId,
        oppositeSide,
      );

      if (!bestOpposing) break; // No opposing orders

      // Check if prices cross (can fill)
      if (!this.pricesCross(incomingOrder, bestOpposing)) break;

      // Remaining quantity of the incoming order
      const incomingRemaining = await this.bookStore.getRemainingQuantity(
        incomingOrder.assetId,
        incomingOrder.orderId,
        incomingOrder.side,
      );

      if (incomingRemaining <= 0n) break; // Fully filled

      // Determine fill quantity (minimum of both remaining quantities)
      const fillQty = incomingRemaining < bestOpposing.remainingQuantity
        ? incomingRemaining
        : bestOpposing.remainingQuantity;

      // Execution price = price of the resting (older) order
      const executionPrice = bestOpposing.price ?? incomingOrder.price!;

      const match: MatchResult = {
        tradeId: randomUUID(),
        buyOrderId: incomingOrder.side === 'buy' ? incomingOrder.orderId : bestOpposing.orderId,
        sellOrderId: incomingOrder.side === 'sell' ? incomingOrder.orderId : bestOpposing.orderId,
        assetId: incomingOrder.assetId,
        asaId: incomingOrder.asaId,
        price: executionPrice,
        quantity: fillQty,
        buyerWalletAddress: incomingOrder.side === 'buy' ? incomingOrder.walletAddress : bestOpposing.walletAddress,
        sellerWalletAddress: incomingOrder.side === 'sell' ? incomingOrder.walletAddress : bestOpposing.walletAddress,
        buyerUserId: incomingOrder.side === 'buy' ? incomingOrder.userId : bestOpposing.userId,
        sellerUserId: incomingOrder.side === 'sell' ? incomingOrder.userId : bestOpposing.userId,
      };

      matches.push(match);

      // Update quantities in Redis
      await this.bookStore.reducQuantity(
        incomingOrder.assetId,
        incomingOrder.orderId,
        incomingOrder.side,
        fillQty,
      );
      await this.bookStore.reducQuantity(
        bestOpposing.assetId,
        bestOpposing.orderId,
        oppositeSide,
        fillQty,
      );

      // Remove fully filled opposing order from book
      if (bestOpposing.remainingQuantity - fillQty <= 0n) {
        await this.bookStore.removeOrder(bestOpposing.assetId, bestOpposing.orderId, oppositeSide);
      }
    }

    return matches;
  }

  // ─── Price crossing logic ─────────────────────────────────────────────────────

  private pricesCross(incoming: PendingOrder, opposing: PendingOrder): boolean {
    if (incoming.type === 'market') return true; // Market orders always cross
    if (!incoming.price || !opposing.price) return true;

    if (incoming.side === 'buy') {
      // Buy crosses if buy price >= lowest ask
      return incoming.price >= opposing.price;
    } else {
      // Sell crosses if sell price <= highest bid
      return incoming.price <= opposing.price;
    }
  }

  // ─── Cancel order from book ───────────────────────────────────────────────────

  async cancelOrder(assetId: string, orderId: string, side: 'buy' | 'sell'): Promise<void> {
    await this.bookStore.removeOrder(assetId, orderId, side);
  }

  async removeOrder(assetId: string, orderId: string): Promise<void> {
    await Promise.allSettled([
      this.bookStore.removeOrder(assetId, orderId, 'buy'),
      this.bookStore.removeOrder(assetId, orderId, 'sell'),
    ]);
  }
}
