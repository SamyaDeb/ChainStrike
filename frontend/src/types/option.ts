// Option-related types

import { Address, MicroAlgo, MicroUSD } from "./common";

export enum OptionType {
  CALL = 0,
  PUT = 1,
}

export enum OptionStatus {
  ACTIVE = 0,
  EXERCISED = 1,
  EXPIRED = 2,
  SETTLED = 3,
}

// Option series (a specific strike + expiry combination)
export interface OptionSeries {
  id: number;
  strikePrice: MicroUSD; // Strike price in microUSD
  expiryTimestamp: number; // Unix timestamp
  optionType: OptionType;
  premiumRateBps: number; // Premium as % of notional
  totalSold: bigint; // Total contracts sold
  totalExercised: bigint; // Total contracts exercised
  collateralLocked: MicroAlgo; // ALGO locked from LP
  isActive: boolean;
}

// User's option position
export interface OptionPosition {
  id: number;
  owner: Address;
  seriesId: number;
  quantity: bigint; // Number of contracts
  premiumPaid: MicroAlgo;
  purchasePrice: MicroUSD; // ALGO price at purchase
  purchasedAt: number; // Timestamp
  status: OptionStatus;
  
  // Computed fields (from series)
  optionType?: OptionType;
  strikePrice?: MicroUSD;
  expiryTimestamp?: number;
}

// Option quote for buying
export interface OptionQuote {
  seriesId: number;
  quantity: bigint;
  premium: MicroAlgo;
  collateralRequired: MicroAlgo;
  currentPrice: MicroUSD;
  breakEvenPrice: MicroUSD;
  maxProfit: MicroAlgo;
  maxLoss: MicroAlgo;
}

// Option payout preview
export interface OptionPayoutPreview {
  positionId: number;
  currentPrice: MicroUSD;
  intrinsicValue: MicroAlgo;
  payout: MicroAlgo;
  profit: MicroAlgo; // payout - premium paid
  profitPercent: number;
  isInTheMoney: boolean;
}

// Option chain display
export interface OptionChainEntry {
  strikePrice: number; // USD
  callSeries?: OptionSeries;
  putSeries?: OptionSeries;
  callPremium?: number; // ALGO
  putPremium?: number; // ALGO
  callOI?: number; // Open interest
  putOI?: number;
}
