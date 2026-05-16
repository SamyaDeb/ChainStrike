import { Injectable } from '@nestjs/common';

export interface BookEntry {
  orderId: string;
  userId: string;
  assetId: string;
  asaId: number;
  marketId: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  price?: bigint;
  quantity: bigint;
  remainingQuantity: bigint;
  walletAddress: string;
  timestamp: number;
}

interface Level { price: string; quantity: string }

@Injectable()
export class InMemoryOrderBookStore {
  // bids[assetId] = array sorted desc by price then asc by timestamp
  private bids = new Map<string, BookEntry[]>();
  // asks[assetId] = array sorted asc by price then asc by timestamp
  private asks = new Map<string, BookEntry[]>();

  private getBook(assetId: string, side: 'buy' | 'sell'): BookEntry[] {
    const map = side === 'buy' ? this.bids : this.asks;
    if (!map.has(assetId)) map.set(assetId, []);
    return map.get(assetId)!;
  }

  addOrder(entry: BookEntry): void {
    const book = this.getBook(entry.assetId, entry.side);
    const insertIdx = this.findInsertIndex(book, entry);
    book.splice(insertIdx, 0, entry);
  }

  // Returns first (best-priced) entry on the opposing side
  getBestOpposing(assetId: string, incomingSide: 'buy' | 'sell'): BookEntry | null {
    const oppSide = incomingSide === 'buy' ? 'sell' : 'buy';
    const book = this.getBook(assetId, oppSide);
    return book[0] ?? null;
  }

  getEntry(assetId: string, side: 'buy' | 'sell', orderId: string): BookEntry | undefined {
    const book = this.getBook(assetId, side);
    return book.find((e) => e.orderId === orderId);
  }

  reduceQuantity(assetId: string, side: 'buy' | 'sell', orderId: string, by: bigint): void {
    const book = this.getBook(assetId, side);
    const entry = book.find((e) => e.orderId === orderId);
    if (entry) entry.remainingQuantity -= by;
  }

  restoreQuantity(assetId: string, side: 'buy' | 'sell', orderId: string, by: bigint): void {
    const book = this.getBook(assetId, side);
    const entry = book.find((e) => e.orderId === orderId);
    if (entry) entry.remainingQuantity += by;
  }

  removeOrder(assetId: string, side: 'buy' | 'sell', orderId: string): void {
    const book = this.getBook(assetId, side);
    const idx = book.findIndex((e) => e.orderId === orderId);
    if (idx !== -1) book.splice(idx, 1);
  }

  removeOrderBothSides(assetId: string, orderId: string): void {
    this.removeOrder(assetId, 'buy', orderId);
    this.removeOrder(assetId, 'sell', orderId);
  }

  getDepth(assetId: string, levels: number): { bids: Level[]; asks: Level[] } {
    const bidBook = this.getBook(assetId, 'buy');
    const askBook = this.getBook(assetId, 'sell');

    return {
      bids: this.aggregateLevels(bidBook, levels),
      asks: this.aggregateLevels(askBook, levels),
    };
  }

  private aggregateLevels(book: BookEntry[], levels: number): Level[] {
    const priceMap = new Map<string, bigint>();
    for (const entry of book) {
      const priceKey = (entry.price ?? 0n).toString();
      priceMap.set(priceKey, (priceMap.get(priceKey) ?? 0n) + entry.remainingQuantity);
      if (priceMap.size >= levels) break;
    }
    return Array.from(priceMap.entries()).map(([price, quantity]) => ({
      price,
      quantity: quantity.toString(),
    }));
  }

  // Binary-search insert position maintaining price-time priority
  private findInsertIndex(book: BookEntry[], entry: BookEntry): number {
    let lo = 0;
    let hi = book.length;
    const entryPrice = entry.price ?? 0n;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const midEntry = book[mid]!;
      const midPrice = midEntry.price ?? 0n;

      const priceBetter = entry.side === 'buy'
        ? entryPrice > midPrice  // Bids: higher price first
        : entryPrice < midPrice; // Asks: lower price first
      const priceWorse = entry.side === 'buy'
        ? entryPrice < midPrice
        : entryPrice > midPrice;

      if (priceBetter) {
        hi = mid;
      } else if (priceWorse) {
        lo = mid + 1;
      } else {
        // Same price: sort ascending by timestamp (earlier = better)
        if (entry.timestamp < midEntry.timestamp) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
    }
    return lo;
  }
}
