// Perpetual position types

import { Address, MicroAlgo, MicroUSD } from "./common";

export enum PositionSide {
  LONG = 0,
  SHORT = 1,
}

export enum PositionStatus {
  OPEN = 0,
  CLOSED = 1,
  LIQUIDATED = 2,
}

// Perpetual position
export interface PerpPosition {
  id: number;
  owner: Address;
  side: PositionSide;
  size: MicroAlgo; // Position size
  margin: MicroAlgo; // Margin deposited
  leverage: number; // 100 = 1x, 2000 = 20x
  entryPrice: MicroUSD;
  lastFundingTime: number;
  accumulatedFunding: bigint; // Can be positive or negative
  openedAt: number;
  status: PositionStatus;
}

// Position with computed values
export interface PerpPositionWithPnL extends PerpPosition {
  currentPrice: MicroUSD;
  unrealizedPnL: bigint; // In microALGO, can be negative
  unrealizedPnLPercent: number;
  liquidationPrice: MicroUSD;
  marginRatio: number; // Basis points
  effectiveMargin: MicroAlgo;
  notionalValue: MicroAlgo;
  isLiquidatable: boolean;
}

// Position open params
export interface OpenPositionParams {
  margin: MicroAlgo;
  size: MicroAlgo;
  isLong: boolean;
  leverage: number;
  maxSlippage?: number; // Basis points
}

// Position close preview
export interface ClosePositionPreview {
  positionId: number;
  currentPrice: MicroUSD;
  pnl: bigint;
  pnlPercent: number;
  fundingPaid: bigint;
  totalReturn: bigint;
  marginReturn: MicroAlgo;
}

// Funding rate info
export interface FundingRateInfo {
  currentRate: number; // Basis points per interval
  isPositive: boolean; // True = longs pay shorts
  nextFundingTime: number;
  longOI: MicroAlgo;
  shortOI: MicroAlgo;
  oiImbalance: number; // Percent
}

// Perps engine stats
export interface PerpsStats {
  totalLongOI: MicroAlgo;
  totalShortOI: MicroAlgo;
  fundingRate: number;
  totalVolume: MicroAlgo;
  totalLiquidations: number;
  totalPnLPaid: MicroAlgo;
}
