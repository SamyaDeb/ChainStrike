"use client";

import { useState, useEffect, useMemo } from "react";
import { OptionType } from "@/types/option";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { getOptionChain } from "@/services/contracts";
import { generateVolatilityBasedStrikes } from "@/lib/options/strike-calculator";
import { calculatePremiumClientSide } from "@/services/premium";

interface OptionChainProps {
  currentPrice: number;
  asset?: string;
  onSelectOption?: (strike: number, type: OptionType) => void;
}

interface ChainEntry {
  strike: number;
  callPremium: number;
  callIV: number;
  callOI: number;
  callDelta: number;
  putPremium: number;
  putIV: number;
  putOI: number;
  putDelta: number;
  expiry?: Date;
}

/**
 * Calculate option premium using the shared premium service
 * This ensures consistency with the option order form
 * Returns both premium and delta from the same calculation
 */
function calculatePremiumAndDelta(currentPrice: number, strike: number, isCall: boolean, expirySeconds: number): { premium: number; delta: number; iv: number } {
  const quote = calculatePremiumClientSide({
    isCall,
    currentPriceMicroUsd: Math.floor(currentPrice * 1_000_000),
    strikePriceMicroUsd: Math.floor(strike * 1_000_000),
    expiryTimestamp: Math.floor(Date.now() / 1000) + expirySeconds,
  });
  
  return {
    // Convert from microALGO to ALGO (per unit)
    premium: quote.premiumPerUnit / 1_000_000,
    // Convert delta from basis points (10000 scale) to decimal (-1 to 1)
    delta: isCall ? quote.delta / 10000 : -(quote.delta / 10000),
    // IV in percentage
    iv: quote.impliedVolatility / 100,
  };
}

/**
 * Generate strike prices around current price
 * Now uses volatility-based calculation for realistic strikes
 */
function generateStrikes(
  currentPrice: number, 
  expirySeconds: number,
  count: number = 11
): number[] {
  // Use volatility-based strike generation
  // This creates realistic strike steps based on expected price movement
  return generateVolatilityBasedStrikes(currentPrice, expirySeconds, count, 0.80);
}

export function OptionChain({ currentPrice, asset = "ALGO", onSelectOption }: OptionChainProps) {
  const [expandedStrike, setExpandedStrike] = useState<number | null>(null);
  const [chainData, setChainData] = useState<ChainEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Default expiry - next Friday (memoized to avoid unnecessary recalculations)
  const expiry = useMemo(() => {
    const now = new Date();
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
    const exp = new Date(now);
    exp.setDate(now.getDate() + daysUntilFriday);
    exp.setHours(16, 0, 0, 0); // 4 PM UTC
    return exp;
  }, []);
  
  const daysToExpiry = useMemo(() => 
    Math.max(1, Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    [expiry]
  );
  
  // Calculate expiry in seconds for volatility-based strikes
  const expirySeconds = useMemo(() => 
    Math.max(60, Math.floor((expiry.getTime() - Date.now()) / 1000)),
    [expiry]
  );

  useEffect(() => {
    async function fetchOptionChain() {
      setIsLoading(true);
      try {
        // Try to get real data from contracts
        const contractData = await getOptionChain(asset, currentPrice);
        
        if (contractData && contractData.length > 0) {
          // Use real contract data
          const chain = contractData.map(opt => ({
            strike: opt.strike,
            callPremium: opt.callPremium,
            callIV: opt.callIV,
            callOI: opt.callOI,
            callDelta: opt.callDelta,
            putPremium: opt.putPremium,
            putIV: opt.putIV,
            putOI: opt.putOI,
            putDelta: opt.putDelta,
            expiry: opt.expiry,
          }));
          setChainData(chain);
        } else {
          // Generate calculated options when no contract data exists
          // This happens when no options have been created yet on the contract
          // Use volatility-based strikes that are realistic for the timeframe
          const strikes = generateStrikes(currentPrice, expirySeconds);
          
          const chain = strikes.map(strike => {
            // Calculate call and put premiums/deltas using the shared service
            const callQuote = calculatePremiumAndDelta(currentPrice, strike, true, expirySeconds);
            const putQuote = calculatePremiumAndDelta(currentPrice, strike, false, expirySeconds);
            
            return {
              strike,
              callPremium: callQuote.premium,
              callIV: callQuote.iv,
              callOI: 0, // No open interest yet
              callDelta: callQuote.delta,
              putPremium: putQuote.premium,
              putIV: putQuote.iv,
              putOI: 0, // No open interest yet
              putDelta: putQuote.delta,
              expiry,
            };
          });
          setChainData(chain);
        }
        
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Error fetching option chain:', error);
        // On error, still show calculated options with volatility-based strikes
        const strikes = generateStrikes(currentPrice, expirySeconds);
        const chain = strikes.map(strike => {
          const callQuote = calculatePremiumAndDelta(currentPrice, strike, true, expirySeconds);
          const putQuote = calculatePremiumAndDelta(currentPrice, strike, false, expirySeconds);
          
          return {
            strike,
            callPremium: callQuote.premium,
            callIV: callQuote.iv,
            callOI: 0,
            callDelta: callQuote.delta,
            putPremium: putQuote.premium,
            putIV: putQuote.iv,
            putOI: 0,
            putDelta: putQuote.delta,
          };
        });
        setChainData(chain);
      } finally {
        setIsLoading(false);
      }
    }

    fetchOptionChain();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchOptionChain, 10000);
    return () => clearInterval(interval);
  }, [currentPrice, asset, daysToExpiry, expiry, expirySeconds]);

  if (isLoading && chainData.length === 0) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-400">Loading option chain...</span>
      </div>
    );
  }
  
  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-7 gap-2 p-4 bg-dark-800 text-xs font-medium text-gray-400 border-b border-glass-border">
        <div className="text-center">OI</div>
        <div className="text-center">IV</div>
        <div className="text-right text-profit">Calls</div>
        <div className="text-center">Strike</div>
        <div className="text-left text-loss">Puts</div>
        <div className="text-center">IV</div>
        <div className="text-center">OI</div>
      </div>
      
      {/* Chain rows */}
      <div className="divide-y divide-glass-border">
        {chainData.map((entry) => {
          const isATM = Math.abs(currentPrice - entry.strike) < currentPrice * 0.01;
          const callITM = currentPrice > entry.strike;
          const putITM = currentPrice < entry.strike;
          const isExpanded = expandedStrike === entry.strike;
          
          return (
            <div key={entry.strike}>
              {/* Main row */}
              <div 
                className={`grid grid-cols-7 gap-2 px-4 py-3 items-center text-sm cursor-pointer hover:bg-dark-800/50 transition-colors ${
                  isATM ? "bg-neon-blue/5 border-l-2 border-neon-blue" : ""
                }`}
                onClick={() => setExpandedStrike(isExpanded ? null : entry.strike)}
              >
                {/* Call side */}
                <div className="text-center text-gray-400 text-xs font-mono">
                  {entry.callOI > 0 ? entry.callOI.toLocaleString() : '-'}
                </div>
                <div className="text-center text-gray-400 text-xs font-mono">
                  {entry.callIV.toFixed(0)}%
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOption?.(entry.strike, OptionType.CALL);
                  }}
                  className={`text-right font-mono group ${
                    callITM ? "text-profit" : "text-gray-300"
                  }`}
                >
                  <span className="group-hover:text-neon-green transition-colors">
                    {entry.callPremium.toFixed(4)}
                  </span>
                  {callITM && <TrendingUp className="inline w-3 h-3 ml-1 text-profit" />}
                </button>
                
                {/* Strike */}
                <div className={`text-center font-mono font-semibold ${
                  isATM ? "text-neon-blue" : "text-white"
                }`}>
                  ${entry.strike.toFixed(2)}
                  {isATM && (
                    <span className="block text-[10px] text-neon-blue font-normal">ATM</span>
                  )}
                </div>
                
                {/* Put side */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOption?.(entry.strike, OptionType.PUT);
                  }}
                  className={`text-left font-mono group ${
                    putITM ? "text-loss" : "text-gray-300"
                  }`}
                >
                  {putITM && <TrendingDown className="inline w-3 h-3 mr-1 text-loss" />}
                  <span className="group-hover:text-neon-green transition-colors">
                    {entry.putPremium.toFixed(4)}
                  </span>
                </button>
                <div className="text-center text-gray-400 text-xs font-mono">
                  {entry.putIV.toFixed(0)}%
                </div>
                <div className="text-center text-gray-400 text-xs font-mono">
                  {entry.putOI > 0 ? entry.putOI.toLocaleString() : '-'}
                </div>
              </div>
              
              {/* Expanded details */}
              {isExpanded && (
                <div className="grid grid-cols-2 gap-4 px-4 py-3 bg-dark-800/30 border-t border-glass-border">
                  {/* Call details */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-profit flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      Call Option
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-gray-400">Delta</span>
                      <span className="text-right font-mono">{entry.callDelta.toFixed(2)}</span>
                      <span className="text-gray-400">Breakeven</span>
                      <span className="text-right font-mono">${(entry.strike + entry.callPremium).toFixed(4)}</span>
                      <span className="text-gray-400">Max Loss</span>
                      <span className="text-right font-mono text-loss">{entry.callPremium.toFixed(4)} ALGO</span>
                    </div>
                  </div>
                  
                  {/* Put details */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-loss flex items-center gap-1">
                      <TrendingDown className="w-4 h-4" />
                      Put Option
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-gray-400">Delta</span>
                      <span className="text-right font-mono">{entry.putDelta.toFixed(2)}</span>
                      <span className="text-gray-400">Breakeven</span>
                      <span className="text-right font-mono">${(entry.strike - entry.putPremium).toFixed(4)}</span>
                      <span className="text-gray-400">Max Loss</span>
                      <span className="text-right font-mono text-loss">{entry.putPremium.toFixed(4)} ALGO</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Footer */}
      <div className="p-4 bg-dark-800 border-t border-glass-border">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Expiry: {expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span className="flex items-center gap-1">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            Last updated: {lastUpdate.toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
}
