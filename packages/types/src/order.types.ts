// ─── Order ────────────────────────────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell';

export type OrderType = 'limit' | 'market';

export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export type OrderStatus =
  | 'new'
  | 'compliance_check'
  | 'accepted'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface Order {
  id: string;
  userId: string;
  assetId: string;
  asaId: number;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  price?: bigint;            // In USDC microunits (6 decimals). Null for market orders.
  quantity: bigint;          // In token base units
  filledQuantity: bigint;
  remainingQuantity: bigint;
  status: OrderStatus;
  rejectionReason?: string;
  escrowTxId?: string;       // On-chain escrow transaction for buy orders
  walletAddress: string;     // Investor's Algorand address
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface PlaceOrderDto {
  assetId: string;
  side: OrderSide;
  type: OrderType;
  timeInForce?: TimeInForce;
  price?: string;            // Decimal string to avoid float precision
  quantity: string;          // Decimal string
}

// ─── Order Book depth ─────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price: bigint;
  quantity: bigint;
  orderCount: number;
}

export interface OrderBook {
  assetId: string;
  asaId: number;
  bids: OrderBookLevel[];   // Sorted highest first
  asks: OrderBookLevel[];   // Sorted lowest first
  lastTradePrice?: bigint;
  spreadAbsolute?: bigint;
  spreadPercent?: number;
  updatedAt: Date;
}

// ─── Market Depth Snapshot ────────────────────────────────────────────────────

export interface MarketDepthSnapshot {
  assetId: string;
  bids: [string, string][];  // [price, quantity] pairs as decimal strings
  asks: [string, string][];
  timestamp: number;         // Unix ms
}
