/**
 * Premium Calculation Service
 * 
 * Calculates option premiums PER 1 ALGO unit.
 * The UI multiplies by quantity for total cost.
 * 
 * IMPORTANT: This service mirrors the formula from contracts/options_market.py
 * but returns PER-UNIT pricing for better UX.
 */

import { CONTRACTS } from '@/config/contracts';
import { getAlgodClient } from '@/lib/algorand/client';
import algosdk from 'algosdk';

// ============================================================================
// Types
// ============================================================================

export interface PremiumQuote {
  premiumPerUnit: number;     // Premium per 1 ALGO in microALGO
  collateralRequired: number; // Collateral needed per 1 ALGO in microALGO  
  impliedVolatility: number;  // IV in basis points (e.g., 8000 = 80%)
  delta: number;              // Delta scaled by 10000 (e.g., 5000 = 0.50)
  // Breakdown (per 1 ALGO)
  intrinsicValue?: number;    // Per 1 ALGO in microALGO
  timeValue?: number;         // Per 1 ALGO in microALGO
}

export interface PremiumParams {
  isCall: boolean;
  currentPriceMicroUsd: number;  // Current spot price in microUSD
  strikePriceMicroUsd: number;   // Strike price in microUSD
  expiryTimestamp: number;       // Unix timestamp for expiry
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_TTL_MS = 5000; // 5 seconds cache
const YEAR_SECONDS = BigInt(31_536_000);
const PRECISION = BigInt(1_000_000);
const ONE_ALGO = BigInt(1_000_000); // 1 ALGO in microALGO
const DEBUG = process.env.NODE_ENV !== 'production'; // Enable debug logging in non-production

// Simple in-memory cache for premium quotes
const premiumCache = new Map<string, { quote: PremiumQuote; timestamp: number }>();

// ============================================================================
// Debug Logging
// ============================================================================

function debugLog(message: string, data?: unknown): void {
  if (DEBUG && typeof window !== 'undefined') {
    console.log(`[Premium] ${message}`, data ?? '');
  }
}

// ============================================================================
// BigInt Math Helpers (matching contract)
// ============================================================================

function sqrtBigInt(x: bigint): bigint {
  if (x === BigInt(0)) return BigInt(0);
  if (x < BigInt(100)) return BigInt(10);
  
  let z = x;
  let y = (z + BigInt(1)) / BigInt(2);
  
  while (y < z) {
    z = y;
    y = (x / y + y) / BigInt(2);
  }
  
  return z;
}

// ============================================================================
// On-Chain Premium Fetching
// ============================================================================

/**
 * Fetch premium quote from on-chain OptionsMarket contract
 * Returns per-unit premium (for 1 ALGO)
 */
export async function getOnChainPremiumQuote(params: PremiumParams): Promise<PremiumQuote | null> {
  const cacheKey = `${params.isCall}-${params.strikePriceMicroUsd}-${params.expiryTimestamp}`;
  
  // Check cache first
  const cached = premiumCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    debugLog('Using cached premium quote');
    return cached.quote;
  }

  try {
    const algodClient = getAlgodClient();
    const contracts = CONTRACTS.testnet;
    
    debugLog('Fetching on-chain premium', {
      appId: contracts.optionsMarket.appId,
      isCall: params.isCall,
      strike: params.strikePriceMicroUsd,
      expiry: params.expiryTimestamp,
    });

    const calculatePremiumMethod = new algosdk.ABIMethod({
      name: 'calculate_premium',
      args: [
        { type: 'bool', name: 'is_call' },
        { type: 'uint64', name: 'strike_price' },
        { type: 'uint64', name: 'expiry' },
        { type: 'uint64', name: 'size' },
      ],
      returns: { type: '(uint64,uint64,uint64,uint64)' },
    });

    const dummySender = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
    const suggestedParams = await algodClient.getTransactionParams().do();

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: contracts.optionsMarket.appId,
      method: calculatePremiumMethod,
      sender: dummySender,
      signer: async () => [],
      suggestedParams,
      methodArgs: [
        params.isCall,
        BigInt(params.strikePriceMicroUsd),
        BigInt(params.expiryTimestamp),
        ONE_ALGO, // Always request for 1 ALGO unit
      ],
      appForeignApps: [contracts.oracle.appId],
    });

    const simResult = await atc.simulate(algodClient, new algosdk.modelsv2.SimulateRequest({
      txnGroups: [],
      allowUnnamedResources: true,
    }));

    if (simResult.methodResults && simResult.methodResults.length > 0) {
      const result = simResult.methodResults[0];
      
      if (result.returnValue) {
        const returnValues = result.returnValue as [bigint, bigint, bigint, bigint];
        const [premium, collateral, iv, delta] = returnValues;
        
        debugLog('On-chain premium result (per 1 ALGO)', {
          premium: Number(premium),
          collateral: Number(collateral),
          iv: Number(iv),
          delta: Number(delta),
        });

        const { intrinsicValue, timeValue } = calculateIntrinsicAndTimeValue({
          isCall: params.isCall,
          spotPriceMicroUsd: params.currentPriceMicroUsd,
          strikePriceMicroUsd: params.strikePriceMicroUsd,
          totalPremium: Number(premium),
        });
        
        const quote: PremiumQuote = {
          premiumPerUnit: Number(premium),
          collateralRequired: Number(collateral),
          impliedVolatility: Number(iv),
          delta: Number(delta),
          intrinsicValue,
          timeValue,
        };

        premiumCache.set(cacheKey, { quote, timestamp: Date.now() });
        return quote;
      }
    }

    debugLog('On-chain simulation returned no result');
    return null;
  } catch (error) {
    debugLog('Failed to fetch on-chain premium', error);
    return null;
  }
}

/**
 * Calculate intrinsic and time value from total premium (for 1 ALGO)
 */
function calculateIntrinsicAndTimeValue(params: {
  isCall: boolean;
  spotPriceMicroUsd: number;
  strikePriceMicroUsd: number;
  totalPremium: number;
}): { intrinsicValue: number; timeValue: number } {
  let intrinsicValue = 0;
  
  if (params.isCall) {
    if (params.spotPriceMicroUsd > params.strikePriceMicroUsd) {
      // ITM Call: intrinsic = (spot - strike) * 1 ALGO / spot
      intrinsicValue = Math.floor(
        ((params.spotPriceMicroUsd - params.strikePriceMicroUsd) * Number(ONE_ALGO)) / 
        params.spotPriceMicroUsd
      );
    }
  } else {
    if (params.strikePriceMicroUsd > params.spotPriceMicroUsd) {
      // ITM Put: intrinsic = (strike - spot) * 1 ALGO / strike
      intrinsicValue = Math.floor(
        ((params.strikePriceMicroUsd - params.spotPriceMicroUsd) * Number(ONE_ALGO)) / 
        params.strikePriceMicroUsd
      );
    }
  }
  
  const timeValue = Math.max(0, params.totalPremium - intrinsicValue);
  
  return { intrinsicValue, timeValue };
}

// ============================================================================
// Client-Side Premium Calculation (Fallback)
// Returns premium per 1 ALGO unit
// ============================================================================

/**
 * Calculate premium client-side matching the contract formula
 * Returns per-unit premium (for 1 ALGO)
 */
export function calculatePremiumClientSide(params: PremiumParams): PremiumQuote {
  const nowTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const spotPrice = BigInt(params.currentPriceMicroUsd);
  const strikePrice = BigInt(params.strikePriceMicroUsd);
  const expiryTimestamp = BigInt(params.expiryTimestamp);
  const size = ONE_ALGO; // Always calculate for 1 ALGO
  
  const baseIV = BigInt(8000); // 80% IV

  if (spotPrice <= BigInt(0) || expiryTimestamp <= nowTimestamp) {
    debugLog('Invalid inputs for premium calculation');
    return { 
      premiumPerUnit: 0, 
      collateralRequired: Number(ONE_ALGO),
      impliedVolatility: 8000,
      delta: 5000,
      intrinsicValue: 0, 
      timeValue: 0,
    };
  }

  const timeToExpiry = expiryTimestamp - nowTimestamp;
  
  // Time factor: sqrt(time_to_expiry / year) * 10000
  const timeFactorInput = (timeToExpiry * BigInt(10000)) / YEAR_SECONDS;
  const timeFactor = sqrtBigInt(timeFactorInput);
  
  debugLog('Time calculation', {
    timeToExpiry: Number(timeToExpiry),
    timeFactor: Number(timeFactor),
  });

  // Time-based IV adjustment
  let volFactor: bigint;
  if (timeToExpiry <= BigInt(60)) {
    volFactor = baseIV * BigInt(2);  // 1-min: 160%
  } else if (timeToExpiry <= BigInt(300)) {
    volFactor = (baseIV * BigInt(3)) / BigInt(2);  // 5-min: 120%
  } else {
    volFactor = baseIV;  // Base: 80%
  }

  // Base premium: (spot * vol * time * 4) / 1e9
  let basePremium = (spotPrice * volFactor * timeFactor * BigInt(4)) / BigInt(1_000_000_000);
  
  debugLog('Base premium calculation', {
    spotPrice: Number(spotPrice),
    volFactor: Number(volFactor),
    basePremium: Number(basePremium),
  });

  let intrinsicValue = BigInt(0);
  let delta = BigInt(5000); // ATM delta = 0.5

  // Adjust for moneyness
  if (params.isCall) {
    if (strikePrice < spotPrice) {
      // ITM Call - add intrinsic value
      intrinsicValue = ((spotPrice - strikePrice) * size) / spotPrice;
      basePremium = basePremium + intrinsicValue;
      delta = BigInt(7500);
    } else if (strikePrice > spotPrice) {
      // OTM Call - linear reduction
      const otmRatio = ((strikePrice - spotPrice) * BigInt(10000)) / spotPrice;
      if (otmRatio < BigInt(5000)) {
        basePremium = (basePremium * (BigInt(10000) - otmRatio)) / BigInt(10000);
        delta = BigInt(5000) - otmRatio / BigInt(2);
        if (delta < BigInt(500)) delta = BigInt(500);
      } else {
        basePremium = basePremium / BigInt(4);
        delta = BigInt(500);
      }
    }
  } else {
    // PUT option
    if (strikePrice > spotPrice) {
      // ITM Put - add intrinsic value
      intrinsicValue = ((strikePrice - spotPrice) * size) / strikePrice;
      basePremium = basePremium + intrinsicValue;
      delta = BigInt(2500);
    } else if (strikePrice < spotPrice) {
      // OTM Put - linear reduction
      const otmRatio = ((spotPrice - strikePrice) * BigInt(10000)) / spotPrice;
      if (otmRatio < BigInt(5000)) {
        basePremium = (basePremium * (BigInt(10000) - otmRatio)) / BigInt(10000);
        delta = BigInt(5000) - otmRatio / BigInt(2);
        if (delta < BigInt(500)) delta = BigInt(500);
      } else {
        basePremium = basePremium / BigInt(4);
        delta = BigInt(500);
      }
    }
  }

  // Scale by size (1 ALGO)
  let premium = (basePremium * size) / PRECISION;
  
  const timeValue = premium > intrinsicValue ? premium - intrinsicValue : BigInt(0);

  debugLog('Pre-minimum premium (per 1 ALGO)', {
    basePremium: Number(basePremium),
    intrinsicValue: Number(intrinsicValue),
    premium: Number(premium),
    timeValue: Number(timeValue),
  });

  // Minimum premium for 1 ALGO: 1% for <5min, 0.5% otherwise
  let minPremium: bigint;
  if (timeToExpiry <= BigInt(300)) {
    minPremium = size / BigInt(100); // 1% minimum
  } else {
    minPremium = size / BigInt(200); // 0.5% minimum
  }

  if (premium < minPremium) {
    debugLog('Applying minimum premium floor', {
      calculated: Number(premium),
      minimum: Number(minPremium),
    });
    premium = minPremium;
  }

  debugLog('Final premium (per 1 ALGO)', {
    premium: Number(premium),
    premiumALGO: Number(premium) / 1_000_000,
    delta: Number(delta),
  });

  return {
    premiumPerUnit: Number(premium),
    collateralRequired: Number(size),
    impliedVolatility: Number(volFactor),
    delta: Number(delta),
    intrinsicValue: Number(intrinsicValue),
    timeValue: Number(timeValue),
  };
}

// ============================================================================
// Combined Premium Fetcher
// ============================================================================

/**
 * Get premium quote - tries on-chain first, falls back to client-side
 * Returns per-unit premium (for 1 ALGO)
 */
export async function getPremiumQuote(params: PremiumParams): Promise<PremiumQuote> {
  debugLog('getPremiumQuote called (per 1 ALGO)', params);
  
  // Try on-chain first
  const onChainQuote = await getOnChainPremiumQuote(params);

  if (onChainQuote && onChainQuote.premiumPerUnit > 0) {
    debugLog('Using on-chain premium quote');
    return onChainQuote;
  }

  // Fallback to client-side calculation
  debugLog('Falling back to client-side calculation');
  return calculatePremiumClientSide(params);
}

/**
 * Clear premium cache
 */
export function clearPremiumCache(): void {
  premiumCache.clear();
  debugLog('Premium cache cleared');
}

/**
 * Get minimum premium for 1 ALGO
 */
export function getMinimumPremiumPerUnit(timeToExpirySeconds: number): number {
  if (timeToExpirySeconds <= 300) {
    return 10000; // 1% of 1 ALGO = 10,000 microALGO
  }
  return 5000; // 0.5% of 1 ALGO = 5,000 microALGO
}
