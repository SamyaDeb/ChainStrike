"use client";

import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, WifiOff } from "lucide-react";
import { AlgoCoinBadge } from "@/components/shared/algorand-logo";
import { useLivePrice } from "@/hooks/usePrice";

export function PriceDisplay() {
  const { data: priceData, isLoading, isError, isFetching, refetch } = useLivePrice();
  
  if (isLoading && !priceData) {
    return (
      <div className="glass-card p-4 flex items-center justify-center min-h-[140px]">
        <RefreshCw className="w-6 h-6 text-neon-green animate-spin" />
        <span className="ml-2 text-gray-400">Loading price data...</span>
      </div>
    );
  }

  if (isError && !priceData) {
    return (
      <div className="glass-card p-4 min-h-[140px]">
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <WifiOff className="w-8 h-8 text-loss" />
          <p className="text-gray-400 text-sm">Unable to fetch price data</p>
          <button 
            onClick={() => refetch()}
            className="px-4 py-2 bg-neon-green/20 hover:bg-neon-green/30 rounded-lg transition-colors text-sm flex items-center gap-2 text-neon-green"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!priceData) {
    return (
      <div className="glass-card p-4 flex items-center gap-2 text-warning">
        <AlertCircle className="w-5 h-5" />
        <span>Waiting for price data...</span>
      </div>
    );
  }

  const isPositive = priceData.change24h >= 0;
  
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AlgoCoinBadge size="lg" showName={true} showSubtitle={true} />
          <span className="text-lg font-bold text-gray-400 ml-1">/ USD</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse"></span>
            <span className="text-xs text-gray-500">Live</span>
          </div>
          
          <div className={`transition-opacity ${isFetching ? 'opacity-100' : 'opacity-0'}`}>
            <RefreshCw className="w-4 h-4 text-neon-green animate-spin" />
          </div>
        </div>
      </div>
      
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-4xl font-bold font-mono">${priceData.price.toFixed(4)}</p>
            <p className="text-lg text-gray-400 font-mono">(~₹{priceData.priceINR?.toFixed(2) || '0.00'})</p>
          </div>
          <div className={`flex items-center gap-1 mt-1 ${isPositive ? 'text-neon-green' : 'text-loss'}`}>
            {isPositive ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">
              {isPositive ? '+' : ''}{priceData.change24h.toFixed(2)}%
            </span>
            <span className="text-xs text-gray-500 ml-1">24h</span>
          </div>
        </div>
        
        <div className="text-right text-sm">
          <div className="flex items-center justify-end gap-2">
            <span className="text-gray-400">H:</span>
            <span className="text-neon-green font-mono">${priceData.high24h.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-gray-400">L:</span>
            <span className="text-loss font-mono">${priceData.low24h.toFixed(4)}</span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-glass-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">24h Volume</span>
          <span className="font-mono">
            {priceData.volume24h > 1_000_000 
              ? `$${(priceData.volume24h / 1_000_000).toFixed(1)}M`
              : `$${(priceData.volume24h / 1_000).toFixed(1)}K`
            }
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
          <span>1 source</span>
          <span>{new Date(priceData.lastUpdate).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}
