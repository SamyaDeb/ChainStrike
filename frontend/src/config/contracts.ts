/**
 * ChainStrike Contract Configuration
 *
 * This file contains all contract addresses, asset IDs, and protocol parameters.
 * Addresses are populated after deployment via the deployment script.
 */

import algosdk from "algosdk";

// ============================================================================
// Contract App IDs
// ============================================================================

export const CONTRACTS = {
  testnet: {
    // Core Infrastructure
    oracle: {
      appId: 758290477,
      address: algosdk.getApplicationAddress(758290477),
      description: "Multi-source price oracle (Binance, CoinGecko, Vestige)",
    },
    strikeToken: {
      appId: 758290478,
      address: algosdk.getApplicationAddress(758290478),
      description: "STRIKE governance token contract",
    },
    staking: {
      appId: 758290479,
      address: algosdk.getApplicationAddress(758290479),
      description: "STRIKE staking and rewards distribution",
    },

    // Options Trading
    optionsPool: {
      appId: 758290646,
      address: algosdk.getApplicationAddress(758290646),
      description: "Options liquidity pool (LPs earn from premiums)",
    },
    optionsMarket: {
      appId: 758290651,
      address: algosdk.getApplicationAddress(758290651),
      description:
        "Options trading (calls/puts with 1-minute to 30-day expiry)",
    },

    // Perpetuals Trading
    perpsPool: {
      appId: 758290663,
      address: algosdk.getApplicationAddress(758290663),
      description: "Perpetuals liquidity pool (counterparty to all positions)",
    },
    perpsMarket: {
      appId: 758290831,
      address: algosdk.getApplicationAddress(758290831),
      description:
        "Perpetuals trading (up to 20x leverage with dynamic fee routing)",
    },
  },
  mainnet: {
    oracle: { appId: 0, address: "", description: "" },
    strikeToken: { appId: 0, address: "", description: "" },
    staking: { appId: 0, address: "", description: "" },
    optionsPool: { appId: 758222938, address: "", description: "" },
    optionsMarket: { appId: 758222941, address: "", description: "" },
    perpsPool: { appId: 0, address: "", description: "" },
    perpsMarket: { appId: 0, address: "", description: "" },
  },
} as const;

// ============================================================================
// Asset IDs (ASAs)
// ============================================================================

export const ASSETS = {
  testnet: {
    strike: {
      id: 0, // STRIKE token needs to be created via STRIKE Token contract
      name: "ChainStrike Token",
      symbol: "STRIKE",
      decimals: 6,
      totalSupply: "1000000000000000", // 1B with 6 decimals
    },
    optionsLP: {
      id: 758299080, // Created by Options Pool initialization
      name: "ChainStrike Options LP",
      symbol: "csOPT",
      decimals: 6,
    },
    perpsLP: {
      id: 758290870, // Created by Perps Pool initialization
      name: "ChainStrike Perps LP",
      symbol: "csPERP",
      decimals: 6,
    },
  },
  mainnet: {
    strike: { id: 0, name: "", symbol: "", decimals: 6, totalSupply: "0" },
    optionsLP: { id: 0, name: "", symbol: "", decimals: 6 },
    perpsLP: { id: 0, name: "", symbol: "", decimals: 6 },
  },
} as const;

// ============================================================================
// Protocol Parameters
// ============================================================================

export const PROTOCOL = {
  // ===== Leverage Settings =====
  MIN_LEVERAGE: 100, // 1x (scaled by 100)
  MAX_LEVERAGE: 2000, // 20x (scaled by 100)
  LEVERAGE_SCALE: 100, // Divisor for leverage values

  // ===== Fee Structure (basis points) =====
  FEES: {
    TRADING_FEE: 10, // 0.1% per trade
    LIQUIDATION_FEE: 100, // 1% liquidation penalty
    LIQUIDATOR_REWARD: 50, // 0.5% to liquidator
    DEPOSIT_FEE: 10, // 0.1% pool deposit fee
    WITHDRAW_FEE: 10, // 0.1% pool withdraw fee
  },

  // ===== Margin Requirements (basis points) =====
  MARGIN: {
    INITIAL: 500, // 5% initial margin
    MAINTENANCE: 250, // 2.5% maintenance margin
  },

  // ===== Options Parameters =====
  OPTIONS: {
    MIN_EXPIRY: 60, // 1 minute minimum (for Turbo Options)
    MAX_EXPIRY: 2592000, // 30 days maximum
    MIN_SIZE: 1_000_000, // 1 ALGO minimum
    DEFAULT_IV: 8000, // 80% implied volatility (basis points)
  },

  // ===== Quick Options (5-minute) =====
  QUICK_OPTIONS: {
    EXPIRY: 300, // 5 minutes
    MIN_SIZE: 1_000_000, // 1 ALGO minimum
    MAX_SIZE: 100_000_000, // 100 ALGO maximum
    PRESET_SIZES: [1, 5, 10, 25, 50], // ALGO amounts for quick selection
  },

  // ===== Pool Parameters =====
  POOLS: {
    MAX_UTILIZATION: 8000, // 80% max utilization
    MIN_DEPOSIT: 1_000_000, // 1 ALGO minimum deposit (microALGO)
    PERPS_MIN_DEPOSIT: 10_000_000, // 10 ALGO for perps pool
  },

  // ===== Funding Rate =====
  FUNDING: {
    INTERVAL: 3600, // 1 hour
    BASE_RATE: 1, // 0.01% per hour base
    MAX_RATE: 100, // 1% per hour maximum
  },

  // ===== Staking Lock Periods =====
  STAKING: {
    LOCK_PERIODS: [0, 30, 90, 180, 365], // Days
    LOCK_MULTIPLIERS: [10000, 12500, 15000, 20000, 30000], // Basis points (1x to 3x)
    MIN_STAKE: 1_000_000, // 1 STRIKE minimum
  },

  // ===== Oracle Settings =====
  ORACLE: {
    MAX_STALENESS: 300, // 5 minutes
    MAX_DEVIATION: 500, // 5% max price deviation
    MIN_SOURCES: 2, // Minimum valid sources
  },
} as const;

// ============================================================================
// Price Data Sources
// ============================================================================

export const PRICE_SOURCES = {
  binance: {
    wsUrl: "wss://stream.binance.com:9443/ws/algousdt@kline_1m",
    tickerUrl: "https://api.binance.com/api/v3/ticker/24hr?symbol=ALGOUSDT",
    priceUrl: "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT",
    klinesUrl: "https://api.binance.com/api/v3/klines",
  },
  coingecko: {
    priceUrl:
      "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd,inr&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true",
    ohlcUrl:
      "https://api.coingecko.com/api/v3/coins/algorand/ohlc?vs_currency=usd&days=1",
  },
  vestige: {
    priceUrl: "https://free-api.vestige.fi/asset/0/price",
    statsUrl: "https://free-api.vestige.fi/asset/0/stats",
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get application address from app ID
 */
export function getAppAddress(appId: number): string {
  if (appId === 0) return "";
  const addr = algosdk.getApplicationAddress(appId);
  return addr.toString();
}

/**
 * Get contract info by name for current network
 */
export function getContract(
  name: keyof typeof CONTRACTS.testnet,
  network: "testnet" | "mainnet" = "testnet",
) {
  const contract = CONTRACTS[network][name];
  return {
    ...contract,
    address: contract.appId > 0 ? getAppAddress(contract.appId) : "",
  };
}

/**
 * Get asset info by name for current network
 */
export function getAsset(
  name: keyof typeof ASSETS.testnet,
  network: "testnet" | "mainnet" = "testnet",
) {
  return ASSETS[network][name];
}

/**
 * Format leverage display (e.g., 1000 -> "10x")
 */
export function formatLeverage(leverage: number): string {
  return `${leverage / PROTOCOL.LEVERAGE_SCALE}x`;
}

/**
 * Format basis points as percentage (e.g., 500 -> "5%")
 */
export function formatBasisPoints(bp: number): string {
  return `${bp / 100}%`;
}

/**
 * Calculate margin required for position
 */
export function calculateRequiredMargin(
  size: bigint,
  leverage: number,
): bigint {
  return (size * BigInt(PROTOCOL.LEVERAGE_SCALE)) / BigInt(leverage);
}

/**
 * Check if expiry is valid for options
 */
export function isValidExpiry(expiryTimestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const timeToExpiry = expiryTimestamp - now;
  return (
    timeToExpiry >= PROTOCOL.OPTIONS.MIN_EXPIRY &&
    timeToExpiry <= PROTOCOL.OPTIONS.MAX_EXPIRY
  );
}

// ============================================================================
// Type Exports
// ============================================================================

export type ContractName = keyof typeof CONTRACTS.testnet;
export type AssetName = keyof typeof ASSETS.testnet;
export type NetworkType = "testnet" | "mainnet";
