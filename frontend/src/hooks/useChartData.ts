import { useQuery } from '@tanstack/react-query';
import { PRICE_SOURCES } from '@/config/contracts';
import type { Candle } from '@/types/common';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

interface BinanceKline {
  0: number; // Open time
  1: string; // Open
  2: string; // High
  3: string; // Low
  4: string; // Close
  5: string; // Volume
  6: number; // Close time
}

/**
 * Convert Binance timeframe to internal format
 */
const timeframeMap: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/**
 * Get number of candles to fetch based on timeframe
 * More candles for longer timeframes
 */
function getCandleLimit(timeframe: Timeframe): number {
  const limits: Record<Timeframe, number> = {
    '1m': 200, // ~3.3 hours
    '5m': 200, // ~16.6 hours
    '15m': 200, // ~50 hours
    '1h': 168, // 7 days
    '4h': 180, // 30 days
    '1d': 90, // 3 months
  };
  return limits[timeframe];
}

/**
 * Fetch historical OHLC data from Binance
 */
async function fetchBinanceKlines(
  timeframe: Timeframe,
  limit?: number
): Promise<Candle[]> {
  const interval = timeframeMap[timeframe];
  const candleLimit = limit || getCandleLimit(timeframe);
  const url = `${PRICE_SOURCES.binance.klinesUrl}?symbol=ALGOUSDT&interval=${interval}&limit=${candleLimit}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch klines: ${response.statusText}`);
    }

    const data: BinanceKline[] = await response.json();
    
    return data.map((kline) => ({
      time: Math.floor(kline[0] / 1000), // Convert to seconds
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Hook to fetch and manage chart data
 * Uses shorter stale time for faster updates
 */
export function useChartData(timeframe: Timeframe) {
  return useQuery<Candle[]>({
    queryKey: ['chartData', timeframe],
    queryFn: () => fetchBinanceKlines(timeframe),
    staleTime: 30 * 1000, // 30 seconds - WebSocket handles realtime updates
    refetchInterval: 60 * 1000, // Refetch every minute as backup
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
    // Keep showing old data while refetching
    placeholderData: (previousData) => previousData,
  });
}
