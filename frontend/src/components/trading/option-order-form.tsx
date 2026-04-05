"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOptionsTrading, type OptionType } from "@/hooks/useTrading";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { PROTOCOL } from "@/config/contracts";
import { getStrikeMultipliersForTimeframe } from "@/lib/options/strike-calculator";
import { getPremiumQuote, type PremiumQuote } from "@/services/premium";
import { TrendingUp, TrendingDown, Calendar, DollarSign, Wallet, AlertCircle, CheckCircle, Loader2 } from "lucide-react";

interface OptionOrderFormProps {
  currentPrice: number;
  onSubmit?: (trade: {
    type: string;
    optionType: OptionType;
    strike: number;
    premium: number;
    quantity: number;
    expiry: Date;
    txId?: string;
  }) => void;
}

export function OptionOrderForm({ currentPrice, onSubmit }: OptionOrderFormProps) {
  const { activeAccount } = useSafeWallet();
  const { buyOption, isLoading, error } = useOptionsTrading();
  
  const [optionType, setOptionType] = useState<OptionType>('call');
  const [strike, setStrike] = useState('');
  const [premium, setPremium] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expirySeconds, setExpirySeconds] = useState(String(PROTOCOL.OPTIONS.MIN_EXPIRY));
  const [lastTradeResult, setLastTradeResult] = useState<{ success: boolean; txId?: string; error?: string } | null>(null);
  const [isPremiumLoading, setIsPremiumLoading] = useState(false);
  const [premiumQuote, setPremiumQuote] = useState<PremiumQuote | null>(null);

  // Calculate strike price suggestions based on current price and option type
  // Uses volatility-based calculation for realistic strikes based on timeframe
  const getStrikeOptions = useCallback(() => {
    const expiryTime = parseInt(expirySeconds, 10) || PROTOCOL.OPTIONS.MIN_EXPIRY;
    
    // Get volatility-based multipliers for this timeframe
    const multipliers = getStrikeMultipliersForTimeframe(expiryTime, 0.80);
    
    return multipliers.map((mult) => {
      const price = currentPrice * mult;
      const percentDiff = Math.round((mult - 1) * 10000) / 100;
      
      // Determine ITM/OTM status based on option type
      let status: 'itm' | 'atm' | 'otm';
      
      if (Math.abs(mult - 1.0) < 0.001) {
        status = 'atm';
      } else if (optionType === 'call') {
        status = mult < 1 ? 'itm' : 'otm';
      } else {
        status = mult > 1 ? 'itm' : 'otm';
      }
      
      const sign = percentDiff > 0 ? '+' : '';
      const percentLabel = Math.abs(percentDiff) < 0.01 ? '' : `${sign}${percentDiff.toFixed(2)}%`;
      const statusLabel = status.toUpperCase();
      const label = `${price.toFixed(6)} (${percentLabel}${percentLabel ? ' ' : ''}${statusLabel})`;
      
      return {
        label,
        value: price.toFixed(6),
        status,
      };
    });
  }, [currentPrice, expirySeconds, optionType]);
  
  const strikeOptions = getStrikeOptions();

  const expiryOptions = [
    { label: '1 Minute ⚡', value: '60' },
    { label: '5 Minutes', value: '300' },
    { label: '1 Hour', value: '3600' },
    { label: '4 Hours', value: '14400' },
    { label: '1 Day', value: '86400' },
    { label: '3 Days', value: '259200' },
    { label: '7 Days', value: '604800' },
    { label: '14 Days', value: '1209600' },
    { label: '30 Days', value: '2592000' },
  ];

  const EXPIRY_BUFFER_SECONDS = 10;
  const selectedExpirySeconds = parseInt(expirySeconds, 10) || PROTOCOL.OPTIONS.MIN_EXPIRY;
  const estimatedSubmissionExpiryTimestamp =
    Math.floor(Date.now() / 1000) + selectedExpirySeconds + EXPIRY_BUFFER_SECONDS;
  
  // Fetch premium from on-chain contract (with client-side fallback)
  // Updates when strike, expiry, or option type changes
  useEffect(() => {
    if (!strike || !currentPrice || currentPrice <= 0) {
      setPremium('');
      setPremiumQuote(null);
      return;
    }

    const strikePrice = parseFloat(strike);
    if (isNaN(strikePrice) || strikePrice <= 0) {
      setPremium('');
      setPremiumQuote(null);
      return;
    }

    // Debounce premium fetching to avoid excessive calls
    const fetchPremium = async () => {
      setIsPremiumLoading(true);
      try {
        // Get premium quote for 1 ALGO unit (quantity-independent)
        const quoteExpiryTimestamp = Math.floor(Date.now() / 1000) + selectedExpirySeconds;
        const quote = await getPremiumQuote({
          isCall: optionType === 'call',
          currentPriceMicroUsd: Math.floor(currentPrice * 1_000_000),
          strikePriceMicroUsd: Math.floor(strikePrice * 1_000_000),
          expiryTimestamp: quoteExpiryTimestamp,
        });

        if (quote && quote.premiumPerUnit > 0) {
          // Convert per-unit premium from microALGO to ALGO
          const premiumPerAlgo = quote.premiumPerUnit / 1_000_000;
          setPremium(premiumPerAlgo.toFixed(6));
          setPremiumQuote(quote);
        } else {
          // Fallback minimum premium (per unit)
          const minPremiumPerUnit = currentPrice * 0.001;
          setPremium(minPremiumPerUnit.toFixed(6));
          setPremiumQuote(null);
        }
      } catch (err) {
        console.error('Error fetching premium:', err);
        // Fallback to minimum premium (per unit)
        const minPremiumPerUnit = currentPrice * 0.001;
        setPremium(minPremiumPerUnit.toFixed(6));
        setPremiumQuote(null);
      } finally {
        setIsPremiumLoading(false);
      }
    };

    const timeout = setTimeout(fetchPremium, 300);
    return () => clearTimeout(timeout);
  }, [strike, optionType, currentPrice, selectedExpirySeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!activeAccount) {
      setLastTradeResult({ success: false, error: 'Please connect your wallet first' });
      return;
    }

    const strikePrice = parseFloat(strike);
    const premiumAmount = parseFloat(premium);
    const quantityAmount = parseInt(quantity);

    if (!strikePrice || !premiumAmount || !quantityAmount) {
      setLastTradeResult({ success: false, error: 'Please fill in all fields with valid values' });
      return;
    }

    try {
      setLastTradeResult(null);

      // Build expiry from current time at submission to avoid stale timestamps
      const submissionExpiryTimestamp =
        Math.floor(Date.now() / 1000) + selectedExpirySeconds + EXPIRY_BUFFER_SECONDS;
      
      // Convert to contract format:
      // - strike: USD -> microUSD (multiply by 1,000,000)
      // - quantity: ALGO contracts -> microALGO (multiply by 1,000,000)
      // - premium: ALGO (stays as ALGO, converted in hook)
      const result = await buyOption({
        optionType,
        strike: strikePrice * 1_000_000,
        expiryTimestamp: submissionExpiryTimestamp,
        quantity: quantityAmount * 1_000_000,
        premium: premiumAmount,
      });

      setLastTradeResult(result);
      
      if (result.success && onSubmit) {
        onSubmit({
          type: 'option',
          optionType,
          strike: strikePrice,
          premium: premiumAmount,
          quantity: quantityAmount,
          expiry: new Date(submissionExpiryTimestamp * 1000),
          txId: result.txId,
        });
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      setLastTradeResult({ success: false, error: errorMessage });
    }
  };

  const totalCost = (parseFloat(premium) || 0) * (parseInt(quantity) || 1);
  const breakeven = optionType === 'call' 
    ? (parseFloat(strike) || 0) + (parseFloat(premium) || 0)
    : (parseFloat(strike) || 0) - (parseFloat(premium) || 0);

  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Options Trading
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Option Type */}
        <div>
          <label className="block text-sm font-medium mb-3">Option Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOptionType('call')}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
                optionType === 'call'
                  ? 'bg-profit/10 text-profit border border-profit/20'
                  : 'bg-dark-700 text-gray-300 hover:bg-dark-600 border border-glass-border'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Call
            </button>
            <button
              type="button"
              onClick={() => setOptionType('put')}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
                optionType === 'put'
                  ? 'bg-loss/10 text-loss border border-loss/20'
                  : 'bg-dark-700 text-gray-300 hover:bg-dark-600 border border-glass-border'
              }`}
            >
              <TrendingDown className="w-4 h-4" />
              Put
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Strike Price */}
          <div>
            <label className="block text-sm font-medium mb-2">Strike Price</label>
            <input
              type="number"
              step="0.000001"
              value={strike}
              onChange={(e) => setStrike(e.target.value)}
              placeholder="0.000000"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg px-4 font-mono focus:outline-none focus:border-neon-green/50 transition-colors"
              required
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {strikeOptions.map((option) => {
                const statusColors = {
                  itm: 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30',
                  atm: 'bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 border border-gray-500/30',
                  otm: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/30',
                };
                
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStrike(option.value)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${statusColors[option.status]}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-sm font-medium mb-2">
              <Calendar className="inline w-4 h-4 mr-1" />
              Expiry
            </label>
            <select
              value={expirySeconds}
              onChange={(e) => setExpirySeconds(e.target.value)}
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg px-4 focus:outline-none focus:border-neon-green/50 transition-colors"
            >
              {expiryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Expires (if submitted now): {new Date(estimatedSubmissionExpiryTimestamp * 1000).toLocaleString()}
            </p>
          </div>

          {/* Premium */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Premium per ALGO (ALGO)
              {isPremiumLoading && (
                <Loader2 className="inline w-3 h-3 ml-2 animate-spin text-gray-400" />
              )}
            </label>
            <input
              type="number"
              step="0.000001"
              value={premium}
              readOnly
              placeholder="0.000000"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg px-4 font-mono focus:outline-none focus:border-neon-green/50 transition-colors"
              required
            />
            {premiumQuote && (
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                {premiumQuote.intrinsicValue !== undefined && (
                  <div className="flex justify-between">
                    <span>Intrinsic Value:</span>
                    <span className="font-mono">{(premiumQuote.intrinsicValue / 1_000_000).toFixed(6)} ALGO</span>
                  </div>
                )}
                {premiumQuote.timeValue !== undefined && (
                  <div className="flex justify-between">
                    <span>Time Value:</span>
                    <span className="font-mono">{(premiumQuote.timeValue / 1_000_000).toFixed(6)} ALGO</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Delta:</span>
                  <span className="font-mono">{(premiumQuote.delta / 10000).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium mb-2">Quantity (ALGO)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="1"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg px-4 font-mono focus:outline-none focus:border-neon-green/50 transition-colors"
              required
            />
          </div>

          {/* Order Summary */}
          {totalCost > 0 && (
            <div className="bg-dark-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Unit Premium</span>
                <span className="font-mono">{(parseFloat(premium) || 0).toFixed(6)} ALGO</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Quantity</span>
                <span className="font-mono">{(parseInt(quantity, 10) || 1).toLocaleString()} ALGO</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Total Cost</span>
                <span className="font-mono font-semibold">{totalCost.toFixed(6)} ALGO</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Breakeven Price</span>
                <span className="font-mono">${breakeven.toFixed(6)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Max Loss</span>
                <span className="font-mono text-loss">{totalCost.toFixed(6)} ALGO</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Max Profit</span>
                <span className="font-mono text-profit">Unlimited</span>
              </div>
            </div>
          )}

          {/* Transaction Result */}
          {lastTradeResult && (
            <div className={`p-3 rounded-lg border flex items-start gap-2 ${
              lastTradeResult.success 
                ? 'bg-profit/10 border-profit/20 text-profit'
                : 'bg-loss/10 border-loss/20 text-loss'
            }`}>
              {lastTradeResult.success ? (
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <div className="text-sm">
                {lastTradeResult.success ? (
                  <>
                    <p className="font-medium">Option purchased successfully!</p>
                    {lastTradeResult.txId && (
                      <p className="text-xs mt-1 opacity-80">
                        Tx: {lastTradeResult.txId.slice(0, 8)}...{lastTradeResult.txId.slice(-8)}
                      </p>
                    )}
                  </>
                ) : (
                  <p>{lastTradeResult.error || 'Transaction failed'}</p>
                )}
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-loss/10 border border-loss/20 rounded-lg text-loss text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Submit Button */}
          {!activeAccount ? (
            <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
              <Wallet className="w-4 h-4" />
              Connect wallet to trade options
            </div>
          ) : (
            <Button 
              type="submit"
              disabled={isLoading || !strike || !premium || !quantity}
              className="w-full gap-2"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <DollarSign className="w-4 h-4" />
                  Buy {optionType.charAt(0).toUpperCase() + optionType.slice(1)} Option
                </>
              )}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
