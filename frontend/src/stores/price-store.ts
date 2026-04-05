import { create } from "zustand";
import { Candle, PriceData } from "@/types/common";

interface PriceState {
  // Current price data
  algo: PriceData | null;
  
  // Historical candles for chart
  candles: Candle[];
  
  // WebSocket connection status
  isConnected: boolean;
  lastError: string | null;
  
  // Actions
  setPrice: (data: Partial<PriceData>) => void;
  setCandles: (candles: Candle[]) => void;
  addCandle: (candle: Candle) => void;
  updateLastCandle: (candle: Partial<Candle>) => void;
  setConnected: (status: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialPriceData: PriceData = {
  price: 0,
  change24h: 0,
  changePercent24h: 0,
  high24h: 0,
  low24h: 0,
  volume24h: 0,
  lastUpdate: 0,
};

export const usePriceStore = create<PriceState>((set) => ({
  algo: null,
  candles: [],
  isConnected: false,
  lastError: null,

  setPrice: (data) =>
    set((state) => ({
      algo: {
        ...(state.algo || initialPriceData),
        ...data,
        lastUpdate: Date.now(),
      },
    })),

  setCandles: (candles) => set({ candles }),

  addCandle: (candle) =>
    set((state) => {
      const candles = [...state.candles];
      const lastCandle = candles[candles.length - 1];

      // Check if we should update the last candle or add a new one
      if (lastCandle && lastCandle.time === candle.time) {
        candles[candles.length - 1] = candle;
      } else {
        candles.push(candle);
        // Keep only last 500 candles
        if (candles.length > 500) {
          candles.shift();
        }
      }

      return { candles };
    }),

  updateLastCandle: (updates) =>
    set((state) => {
      const candles = [...state.candles];
      if (candles.length > 0) {
        candles[candles.length - 1] = {
          ...candles[candles.length - 1],
          ...updates,
        };
      }
      return { candles };
    }),

  setConnected: (isConnected) => set({ isConnected, lastError: null }),

  setError: (lastError) => set({ lastError, isConnected: false }),

  reset: () =>
    set({
      algo: null,
      candles: [],
      isConnected: false,
      lastError: null,
    }),
}));

// Selectors
export const selectAlgoPrice = (state: PriceState) => state.algo?.price ?? 0;
export const selectPriceChange = (state: PriceState) => state.algo?.changePercent24h ?? 0;
export const selectCandles = (state: PriceState) => state.candles;
export const selectIsConnected = (state: PriceState) => state.isConnected;
