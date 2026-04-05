// Liquidity pool types

import { Address, MicroAlgo } from "./common";

// LP position (raw from contract)
export interface LPPosition {
  owner: Address;
  shares: bigint; // csALGO shares
  depositedAt: number;
  lastClaimTime: number;
}

// LP position with computed values
export interface LPPositionWithValue extends LPPosition {
  sharePrice: MicroAlgo; // Price per share in microALGO
  totalValue: MicroAlgo; // Total value in ALGO
  initialDeposit: MicroAlgo;
  earnedYield: MicroAlgo;
  yieldPercent: number;
}

// LP position data (user-friendly, in ALGO not microALGO)
export interface UserLPPosition {
  shares: number; // LP tokens held
  depositedValue: number; // Original ALGO deposited
  currentValue: number; // Current value in ALGO
  entryTime: number; // Unix timestamp when deposited
  earnings: number; // Profit/loss in ALGO (currentValue - depositedValue)
  shareOfPool: number; // Percentage of total pool (0-100)
}

// Pool stats (legacy - kept for compatibility)
export interface PoolStats {
  totalDeposits: MicroAlgo;
  totalShares: bigint;
  utilizedCapital: MicroAlgo;
  availableCapital: MicroAlgo;
  accumulatedPremiums: MicroAlgo;
  accumulatedFunding: MicroAlgo;
  accumulatedFees: MicroAlgo;
  utilizationRate: number; // Basis points
  sharePrice: MicroAlgo;
  apy: number; // Estimated APY
}

// Pool data (complete pool state including user position)
export interface PoolData {
  // Global pool stats
  totalLiquidity: number; // Total ALGO in pool
  availableLiquidity: number; // ALGO available for positions
  utilizedLiquidity: number; // ALGO locked in positions
  totalShares: number; // Total LP shares issued
  sharePrice: number; // Current share price (ALGO per share)
  apy: number; // Annual percentage yield
  utilizationRate: number; // Utilization as percentage (0-100)
  lpCount: number; // Number of LPs
  totalEarnings: number; // Total premiums/fees earned
  totalPayouts: number; // Total payouts made
  
  // User position (null if no position)
  userPosition: UserLPPosition | null;
}

// Deposit preview
export interface DepositPreview {
  amount: MicroAlgo;
  sharesToReceive: bigint;
  sharePrice: MicroAlgo;
  poolSharePercent: number;
}

// Withdraw preview
export interface WithdrawPreview {
  shares: bigint;
  algoToReceive: MicroAlgo;
  withdrawalFee: MicroAlgo;
  netAmount: MicroAlgo;
  sharePrice: MicroAlgo;
}

// Pool activity event
export interface PoolActivity {
  id: string;
  type: "deposit" | "withdraw" | "premium" | "funding" | "payout" | "liquidation";
  amount: MicroAlgo;
  address?: Address;
  timestamp: number;
  txId?: string;
}
