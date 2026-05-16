// ─── Trade ────────────────────────────────────────────────────────────────────

export type TradeStatus =
  | 'matched'        // Orders matched off-chain, settlement pending
  | 'settling'       // Atomic TX submitted to Algorand
  | 'settled'        // Confirmed on-chain
  | 'failed'         // Settlement failed, back to retry
  | 'cancelled';     // Manually cancelled during settlement

export interface Trade {
  id: string;
  assetId: string;
  asaId: number;

  // Order references
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  buyerWalletAddress: string;
  sellerWalletAddress: string;

  // Execution
  price: bigint;              // In USDC microunits
  quantity: bigint;           // In token base units
  totalValue: bigint;         // price × quantity
  platformFee: bigint;        // Fee collected (in USDC)
  feeRate: number;            // e.g. 0.0025 for 0.25%

  // Settlement
  status: TradeStatus;
  settlementAttempts: number;
  onChainTxId?: string;       // Algorand transaction ID after settlement
  settledAt?: Date;
  failureReason?: string;

  matchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── OHLCV Bar ────────────────────────────────────────────────────────────────

export type OhlcvInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface OhlcvBar {
  assetId: string;
  interval: OhlcvInterval;
  timestamp: number;    // Unix seconds, start of bar
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;       // Token quantity
  trades: number;       // Number of trades in bar
}

// ─── Market Summary ───────────────────────────────────────────────────────────

export interface MarketSummary {
  assetId: string;
  asaId: number;
  lastPrice: bigint;
  priceChange24h: bigint;
  priceChangePct24h: number;
  volume24h: bigint;
  high24h: bigint;
  low24h: bigint;
  totalTrades24h: number;
  marketCap: bigint;
  updatedAt: Date;
}
