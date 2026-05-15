import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConfig } from '@chainstrike/config';
import { PendingOrder } from '../engine/matching.engine';

// ─────────────────────────────────────────────────────────────────────────────
// OrderBookStore — Redis-backed order book state
//
// Data structure per market (assetId):
//   bids:{assetId}   → Redis Sorted Set, score = price (DESC via negation)
//   asks:{assetId}   → Redis Sorted Set, score = price (ASC)
//   order:{orderId}  → Redis Hash, order details including remainingQuantity
//
// Within a price level, orders are sub-sorted by timestamp (price-time priority).
// Redis sorted set member = "<price_padded>:<timestamp>:<orderId>"
// This encoding ensures lexicographic sort gives price-time priority.
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_PADDING = 20; // Zero-pad prices to 20 digits for lex sort

@Injectable()
export class OrderBookStore implements OnModuleInit {
  private readonly logger = new Logger(OrderBookStore.name);
  private redis!: Redis;

  onModuleInit() {
    this.redis = new Redis(redisConfig());
    this.redis.on('error', (err) => this.logger.error('Redis error:', err));
  }

  async addOrder(order: PendingOrder): Promise<void> {
    const key = this.bookKey(order.assetId, order.side);
    const memberKey = this.memberKey(order.price, order.timestamp, order.orderId);

    const multi = this.redis.multi();

    // Add to sorted set (score = price; negated for bids so highest is first)
    const score = order.side === 'buy'
      ? -(order.price ? Number(order.price) : 0)
      : Number(order.price ?? 0);

    multi.zadd(key, score, memberKey);

    // Store full order details as a hash
    multi.hset(`order:${order.orderId}`, {
      orderId: order.orderId,
      userId: order.userId,
      assetId: order.assetId,
      asaId: order.asaId.toString(),
      side: order.side,
      type: order.type,
      timeInForce: order.timeInForce,
      price: order.price?.toString() ?? '',
      quantity: order.quantity.toString(),
      remainingQuantity: order.remainingQuantity.toString(),
      walletAddress: order.walletAddress,
      timestamp: order.timestamp.toString(),
    });

    // Set TTL: 7 days for GTC orders; cleanup expired orders
    multi.expire(`order:${order.orderId}`, 7 * 24 * 3600);

    await multi.exec();
  }

  async getBestOrder(assetId: string, side: 'buy' | 'sell'): Promise<PendingOrder | null> {
    const key = this.bookKey(assetId, side);

    // ZRANGE with limit=1 gets the best-priced (lowest score) entry
    const members = await this.redis.zrange(key, 0, 0);
    if (!members.length) return null;

    const orderId = this.extractOrderId(members[0]!);
    return this.getOrderDetails(orderId, assetId);
  }

  async getRemainingQuantity(assetId: string, orderId: string, side: 'buy' | 'sell'): Promise<bigint> {
    const remaining = await this.redis.hget(`order:${orderId}`, 'remainingQuantity');
    return remaining ? BigInt(remaining) : 0n;
  }

  async reducQuantity(
    assetId: string,
    orderId: string,
    side: 'buy' | 'sell',
    fillQty: bigint,
  ): Promise<void> {
    const current = await this.getRemainingQuantity(assetId, orderId, side);
    const newRemaining = current - fillQty;
    await this.redis.hset(`order:${orderId}`, 'remainingQuantity', newRemaining.toString());
  }

  async removeOrder(assetId: string, orderId: string, side: 'buy' | 'sell'): Promise<void> {
    const key = this.bookKey(assetId, side);

    // Find the member key for this order
    const details = await this.redis.hgetall(`order:${orderId}`);
    if (!details['timestamp']) return;

    const memberKey = this.memberKey(
      details['price'] ? BigInt(details['price']) : undefined,
      parseInt(details['timestamp'], 10),
      orderId,
    );

    const multi = this.redis.multi();
    multi.zrem(key, memberKey);
    multi.del(`order:${orderId}`);
    await multi.exec();
  }

  // ─── Market depth snapshot (for UI) ──────────────────────────────────────────

  async getDepthSnapshot(assetId: string, levels = 20): Promise<{
    bids: [string, string][];
    asks: [string, string][];
  }> {
    const [bidMembers, askMembers] = await Promise.all([
      this.redis.zrange(this.bookKey(assetId, 'buy'), 0, levels - 1, 'WITHSCORES'),
      this.redis.zrange(this.bookKey(assetId, 'sell'), 0, levels - 1, 'WITHSCORES'),
    ]);

    return {
      bids: this.aggregateLevels(bidMembers, 'buy'),
      asks: this.aggregateLevels(askMembers, 'sell'),
    };
  }

  private aggregateLevels(membersWithScores: string[], side: 'buy' | 'sell'): [string, string][] {
    const levels = new Map<string, bigint>();

    for (let i = 0; i < membersWithScores.length; i += 2) {
      const member = membersWithScores[i]!;
      const price = this.extractPrice(member, side);
      const orderId = this.extractOrderId(member);
      // Fetch quantity from hash (simplified — in production batch with pipeline)
      levels.set(price, (levels.get(price) ?? 0n) + 1n);
    }

    return Array.from(levels.entries()).map(([price, qty]) => [price, qty.toString()]);
  }

  private async getOrderDetails(orderId: string, assetId: string): Promise<PendingOrder | null> {
    const data = await this.redis.hgetall(`order:${orderId}`);
    if (!data['orderId']) return null;

    return {
      orderId: data['orderId'],
      userId: data['userId']!,
      assetId: data['assetId'] ?? assetId,
      asaId: parseInt(data['asaId']!, 10),
      side: data['side'] as 'buy' | 'sell',
      type: data['type'] as 'limit' | 'market',
      timeInForce: data['timeInForce'] as 'GTC' | 'IOC' | 'FOK',
      price: data['price'] ? BigInt(data['price']) : undefined,
      quantity: BigInt(data['quantity']!),
      remainingQuantity: BigInt(data['remainingQuantity']!),
      walletAddress: data['walletAddress']!,
      timestamp: parseInt(data['timestamp']!, 10),
    };
  }

  private bookKey(assetId: string, side: 'buy' | 'sell'): string {
    return `book:${assetId}:${side === 'buy' ? 'bids' : 'asks'}`;
  }

  private memberKey(price: bigint | undefined, timestamp: number, orderId: string): string {
    const priceStr = (price ?? 0n).toString().padStart(PRICE_PADDING, '0');
    return `${priceStr}:${timestamp}:${orderId}`;
  }

  private extractOrderId(member: string): string {
    const parts = member.split(':');
    return parts[parts.length - 1]!;
  }

  private extractPrice(member: string, side: 'buy' | 'sell'): string {
    const priceStr = member.split(':')[0]!;
    const price = BigInt(priceStr);
    return (side === 'buy' ? -price : price).toString();
  }
}
