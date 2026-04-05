import { PRICE_SOURCES } from "@/config/contracts";
import type { PriceData } from "@/types/common";

const DEFAULT_INR_RATE = 83;
const FALLBACK_PRICE_USD = 0.106;

type BinanceTicker24h = {
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
};

type CoinGeckoSimple = {
  algorand?: {
    usd?: number;
    inr?: number;
    usd_24h_change?: number;
    inr_24h_change?: number;
    usd_24h_vol?: number;
    inr_24h_vol?: number;
  };
};

type VestigePriceResponse = {
  price?: number;
  timestamp?: number;
};

type VestigeStatsResponse = {
  change_24h?: number;
  volume_24h?: number;
  high_24h?: number;
  low_24h?: number;
};

let lastGoodPrice: PriceData | null = null;

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePriceData(partial: Partial<PriceData>): PriceData {
  const price = toNumber(partial.price, FALLBACK_PRICE_USD);
  const priceINR = toNumber(partial.priceINR, price * DEFAULT_INR_RATE);
  const changePercent24h = toNumber(partial.changePercent24h, toNumber(partial.change24h, 0));

  return {
    price,
    priceINR,
    change24h: toNumber(partial.change24h, changePercent24h),
    changePercent24h,
    change24hINR: toNumber(partial.change24hINR, 0),
    high24h: toNumber(partial.high24h, price),
    low24h: toNumber(partial.low24h, price),
    high24hINR: toNumber(partial.high24hINR, toNumber(partial.high24h, price) * DEFAULT_INR_RATE),
    low24hINR: toNumber(partial.low24hINR, toNumber(partial.low24h, price) * DEFAULT_INR_RATE),
    volume24h: toNumber(partial.volume24h, 0),
    lastUpdate: toNumber(partial.lastUpdate, Date.now()),
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCoinGeckoPrice(): Promise<Partial<PriceData> | null> {
  try {
    const response = await fetchWithTimeout(PRICE_SOURCES.coingecko.priceUrl, 5000);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CoinGeckoSimple;
    const algo = data.algorand;
    if (!algo || !algo.usd) {
      return null;
    }

    const price = toNumber(algo.usd, 0);
    const inr = toNumber(algo.inr, price * DEFAULT_INR_RATE);
    const highEstimate = price * 1.02;
    const lowEstimate = price * 0.98;

    return {
      price,
      priceINR: inr,
      change24h: toNumber(algo.usd_24h_change, 0),
      changePercent24h: toNumber(algo.usd_24h_change, 0),
      change24hINR: toNumber(algo.inr_24h_change, 0),
      high24h: highEstimate,
      low24h: lowEstimate,
      high24hINR: highEstimate * DEFAULT_INR_RATE,
      low24hINR: lowEstimate * DEFAULT_INR_RATE,
      volume24h: toNumber(algo.usd_24h_vol, 0),
      lastUpdate: Date.now(),
    };
  } catch {
    return null;
  }
}

async function fetchVestigePrice(): Promise<Partial<PriceData> | null> {
  try {
    const [priceResp, statsResp] = await Promise.all([
      fetchWithTimeout(PRICE_SOURCES.vestige.priceUrl, 5000),
      fetchWithTimeout(PRICE_SOURCES.vestige.statsUrl, 5000),
    ]);

    if (!priceResp.ok) {
      return null;
    }

    const priceData = (await priceResp.json()) as VestigePriceResponse;
    const statsData = statsResp.ok ? ((await statsResp.json()) as VestigeStatsResponse) : {};
    const price = toNumber(priceData.price, 0);

    if (price <= 0) {
      return null;
    }

    const high24h = toNumber(statsData.high_24h, price * 1.02);
    const low24h = toNumber(statsData.low_24h, price * 0.98);

    return {
      price,
      priceINR: price * DEFAULT_INR_RATE,
      change24h: toNumber(statsData.change_24h, 0),
      changePercent24h: toNumber(statsData.change_24h, 0),
      change24hINR: 0,
      high24h,
      low24h,
      high24hINR: high24h * DEFAULT_INR_RATE,
      low24hINR: low24h * DEFAULT_INR_RATE,
      volume24h: toNumber(statsData.volume_24h, 0),
      lastUpdate: toNumber(priceData.timestamp, Date.now()),
    };
  } catch {
    return null;
  }
}

async function fetchBinancePrice(): Promise<Partial<PriceData> | null> {
  try {
    const response = await fetchWithTimeout(PRICE_SOURCES.binance.tickerUrl, 5000);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as BinanceTicker24h;
    const price = toNumber(data.lastPrice, 0);
    if (price <= 0) {
      return null;
    }

    const high24h = toNumber(data.highPrice, price);
    const low24h = toNumber(data.lowPrice, price);

    return {
      price,
      priceINR: price * DEFAULT_INR_RATE,
      change24h: toNumber(data.priceChangePercent, 0),
      changePercent24h: toNumber(data.priceChangePercent, 0),
      change24hINR: 0,
      high24h,
      low24h,
      high24hINR: high24h * DEFAULT_INR_RATE,
      low24hINR: low24h * DEFAULT_INR_RATE,
      volume24h: toNumber(data.quoteVolume, 0),
      lastUpdate: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function fetchPriceData(): Promise<PriceData> {
  const sources = await Promise.all([
    fetchBinancePrice(),
    fetchVestigePrice(),
    fetchCoinGeckoPrice(),
  ]);

  const best = sources.find((item) => item && toNumber(item.price, 0) > 0);

  if (best) {
    const normalized = normalizePriceData(best);
    lastGoodPrice = normalized;
    return normalized;
  }

  if (lastGoodPrice) {
    return {
      ...lastGoodPrice,
      lastUpdate: Date.now(),
    };
  }

  const fallback = normalizePriceData({
    price: FALLBACK_PRICE_USD,
    priceINR: FALLBACK_PRICE_USD * DEFAULT_INR_RATE,
    high24h: FALLBACK_PRICE_USD * 1.02,
    low24h: FALLBACK_PRICE_USD * 0.98,
    high24hINR: FALLBACK_PRICE_USD * 1.02 * DEFAULT_INR_RATE,
    low24hINR: FALLBACK_PRICE_USD * 0.98 * DEFAULT_INR_RATE,
    change24h: 0,
    changePercent24h: 0,
    change24hINR: 0,
    volume24h: 0,
    lastUpdate: Date.now(),
  });

  lastGoodPrice = fallback;
  return fallback;
}

export function formatChange24h(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

export function formatVolume(volume: number): string {
  if (volume >= 1e9) {
    return `$${(volume / 1e9).toFixed(2)}B`;
  }
  if (volume >= 1e6) {
    return `$${(volume / 1e6).toFixed(2)}M`;
  }
  if (volume >= 1e3) {
    return `$${(volume / 1e3).toFixed(2)}K`;
  }
  return `$${volume.toFixed(2)}`;
}
