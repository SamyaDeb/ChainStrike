// Common types used across the application

export type Address = string;
export type AppId = number;
export type AssetId = number;
export type MicroAlgo = bigint;
export type MicroUSD = bigint;

// Transaction result
export interface TxnResult {
  txId: string;
  confirmedRound: number;
}

// User account info
export interface AccountInfo {
  address: Address;
  balance: MicroAlgo;
  minBalance: MicroAlgo;
  assets: AssetHolding[];
  appsLocalState: AppLocalState[];
}

export interface AssetHolding {
  assetId: AssetId;
  amount: bigint;
  isFrozen: boolean;
}

export interface AppLocalState {
  appId: AppId;
  keyValue: Record<string, unknown>;
}

// Price data
export interface PriceData {
  price: number;
  priceINR?: number;
  change24h: number;
  changePercent24h: number;
  change24hINR?: number;
  high24h: number;
  low24h: number;
  high24hINR?: number;
  low24hINR?: number;
  volume24h: number;
  lastUpdate: number;
}

// Candle data for charts
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Pagination
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Notification/Toast
export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  duration?: number;
}
