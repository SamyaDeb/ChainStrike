"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Clock, Activity } from "lucide-react";

interface FundingData {
  rate: number;
  isPositive: boolean;
  nextFunding: number;
  longOI: number;
  shortOI: number;
}

function useFundingRate() {
  const [funding, setFunding] = useState<FundingData>({
    rate: 0.0012,
    isPositive: true,
    nextFunding: Date.now() + 4 * 60 * 60 * 1000, // 4 hours from now
    longOI: 1_250_000,
    shortOI: 980_000,
  });
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFunding(prev => ({
        ...prev,
        rate: prev.rate + (Math.random() - 0.5) * 0.0002,
        nextFunding: prev.nextFunding - 1000,
      }));
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return funding;
}

function formatCountdown(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "Now";
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function FundingRateDisplay() {
  const funding = useFundingRate();
  const totalOI = funding.longOI + funding.shortOI;
  const longPercent = (funding.longOI / totalOI) * 100;
  
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">Funding Rate</h3>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          Next: {formatCountdown(funding.nextFunding)}
        </div>
      </div>
      
      {/* Current funding rate */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            funding.isPositive ? "bg-profit/10" : "bg-loss/10"
          }`}>
            {funding.isPositive ? (
              <TrendingUp className="w-4 h-4 text-profit" />
            ) : (
              <TrendingDown className="w-4 h-4 text-loss" />
            )}
          </div>
          <div>
            <p className={`text-xl font-bold font-mono ${
              funding.isPositive ? "text-profit" : "text-loss"
            }`}>
              {funding.isPositive ? "+" : ""}{(funding.rate * 100).toFixed(4)}%
            </p>
            <p className="text-xs text-gray-500">
              {funding.isPositive ? "Longs pay shorts" : "Shorts pay longs"}
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <p className="text-sm text-gray-400">Annualized</p>
          <p className={`font-mono ${funding.isPositive ? "text-profit" : "text-loss"}`}>
            {(funding.rate * 100 * 3 * 365).toFixed(2)}%
          </p>
        </div>
      </div>
      
      {/* Open Interest */}
      <div className="pt-4 border-t border-glass-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            Open Interest
          </span>
          <span className="text-xs font-mono">${(totalOI / 1000).toFixed(0)}K</span>
        </div>
        
        {/* OI bar */}
        <div className="h-2 bg-dark-700 rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-profit transition-all"
            style={{ width: `${longPercent}%` }}
          />
          <div 
            className="h-full bg-loss transition-all"
            style={{ width: `${100 - longPercent}%` }}
          />
        </div>
        
        <div className="flex justify-between text-xs mt-2">
          <span className="text-profit">
            Long: ${(funding.longOI / 1000).toFixed(0)}K ({longPercent.toFixed(1)}%)
          </span>
          <span className="text-loss">
            Short: ${(funding.shortOI / 1000).toFixed(0)}K ({(100 - longPercent).toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}
