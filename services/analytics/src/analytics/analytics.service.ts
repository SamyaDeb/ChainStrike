import { Injectable } from '@nestjs/common';
import { EventEnvelope, OrderMatchedPayload, TradeSettledPayload } from '@chainstrike/types';

type Ohlcv = {
  bucketStart: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type MarketSummary = {
  asaId: number;
  lastPrice: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  tradeCount24h: number;
};

@Injectable()
export class AnalyticsService {
  private readonly ohlcv = new Map<number, Ohlcv[]>();
  private readonly summary = new Map<number, MarketSummary>();

  onOrderMatched(envelope: EventEnvelope<OrderMatchedPayload>) {
    const asaId = envelope.payload.asaId;
    this.upsertFromTrade(asaId, envelope.payload.price, envelope.payload.quantity, envelope.timestamp);
  }

  onTradeSettled(envelope: EventEnvelope<TradeSettledPayload>) {
    const asaId = envelope.payload.asaId;
    this.upsertFromTrade(asaId, envelope.payload.price, envelope.payload.quantity, envelope.timestamp);
  }

  getOhlcv(asaId: number) {
    return this.ohlcv.get(asaId) ?? [];
  }

  getSummary(asaId: number) {
    return this.summary.get(asaId) ?? null;
  }

  private upsertFromTrade(asaId: number, price: string, quantity: string, isoTs: string) {
    const bucketStart = this.toMinuteBucket(isoTs);
    const series = this.ohlcv.get(asaId) ?? [];
    const last = series[0];

    const px = BigInt(price);
    const qty = BigInt(quantity);

    if (!last || last.bucketStart !== bucketStart) {
      series.unshift({
        bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: quantity,
      });
      if (series.length > 500) {
        series.length = 500;
      }
    } else {
      const high = BigInt(last.high);
      const low = BigInt(last.low);
      last.high = (px > high ? px : high).toString();
      last.low = (px < low ? px : low).toString();
      last.close = price;
      last.volume = (BigInt(last.volume) + qty).toString();
    }

    this.ohlcv.set(asaId, series);
    this.recomputeSummary(asaId);
  }

  private recomputeSummary(asaId: number) {
    const series = this.ohlcv.get(asaId) ?? [];
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const last24 = series.filter((item) => new Date(item.bucketStart).getTime() >= dayAgo);

    if (last24.length === 0) {
      return;
    }

    let volume24h = 0n;
    let high24h = BigInt(last24[0].high);
    let low24h = BigInt(last24[0].low);

    for (const bar of last24) {
      volume24h += BigInt(bar.volume);
      const high = BigInt(bar.high);
      const low = BigInt(bar.low);
      if (high > high24h) high24h = high;
      if (low < low24h) low24h = low;
    }

    const latest = series[0];
    this.summary.set(asaId, {
      asaId,
      lastPrice: latest.close,
      volume24h: volume24h.toString(),
      high24h: high24h.toString(),
      low24h: low24h.toString(),
      tradeCount24h: last24.length,
    });
  }

  private toMinuteBucket(isoTs: string): string {
    const d = new Date(isoTs);
    d.setUTCSeconds(0, 0);
    return d.toISOString();
  }
}
