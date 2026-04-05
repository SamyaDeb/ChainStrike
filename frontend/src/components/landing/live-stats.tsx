"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, Users, BarChart2, Wallet } from "lucide-react";
import { AlgoCoinBadge } from "@/components/shared/algorand-logo";
import { useLivePrice } from "@/hooks/usePrice";

interface StatData {
  label: string;
  value: string;
  change: number;
  icon: React.ComponentType<{ className?: string }>;
  prefix?: string;
  color: string;
}

// Simulated live data
function useLiveStats() {
  const [stats, setStats] = useState<StatData[]>([
    { label: "Total Value Locked", value: "2,423,891", change: 5.2, icon: Wallet, prefix: "$", color: "neon-green" },
    { label: "24h Trading Volume", value: "12,847,234", change: 12.8, icon: BarChart2, prefix: "$", color: "neon-cyan" },
    { label: "Open Interest", value: "8,234,521", change: -2.1, icon: Activity, prefix: "$", color: "neon-green" },
    { label: "Active Traders", value: "892", change: 8.4, icon: Users, color: "neon-cyan" },
  ]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(prev => prev.map(stat => ({
        ...stat,
        value: simulateValueChange(stat.value, stat.label),
        change: stat.change + (Math.random() - 0.5) * 0.5,
      })));
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  return stats;
}

function simulateValueChange(current: string, label: string): string {
  const num = parseInt(current.replace(/,/g, ''));
  let delta = 0;
  
  if (label.includes("Volume")) {
    delta = Math.floor((Math.random() - 0.3) * 50000);
  } else if (label.includes("TVL")) {
    delta = Math.floor((Math.random() - 0.4) * 10000);
  } else if (label.includes("Interest")) {
    delta = Math.floor((Math.random() - 0.5) * 20000);
  } else if (label.includes("Traders")) {
    delta = Math.floor((Math.random() - 0.4) * 5);
  }
  
  return Math.max(0, num + delta).toLocaleString();
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-green" />
      </span>
      <span className="text-xs text-gray-400 uppercase tracking-wide">Live</span>
    </div>
  );
}

function StatCard({ stat }: { stat: StatData }) {
  const isPositive = stat.change >= 0;
  const Icon = stat.icon;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;
  
  return (
    <div className="group relative">
      {/* Hover glow effect */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-green to-neon-cyan rounded-2xl opacity-0 group-hover:opacity-15 blur transition-opacity duration-300" />
      
      <div className="relative glass-card p-6 rounded-xl hover:border-neon-green/20 transition-all duration-300">
        <div className="flex items-start justify-between mb-4">
          <div className={`w-10 h-10 rounded-xl bg-${stat.color}/10 flex items-center justify-center`}>
            <Icon className={`w-5 h-5 text-${stat.color}`} />
          </div>
          
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            isPositive 
              ? 'bg-neon-green/10 text-neon-green' 
              : 'bg-loss/10 text-loss'
          }`}>
            <TrendIcon className="w-3 h-3" />
            {isPositive ? '+' : ''}{stat.change.toFixed(1)}%
          </div>
        </div>
        
        <p className="text-3xl font-bold text-white mb-1 font-mono">
          {stat.prefix}{stat.value}
        </p>
        <p className="text-sm text-gray-400">{stat.label}</p>
      </div>
    </div>
  );
}

export function LiveStats() {
  const stats = useLiveStats();
  const { data: priceData } = useLivePrice();
  
  return (
    <section className="relative py-20 bg-gradient-to-b from-dark-950 to-dark-900">
      {/* Animated background grid */}
      <div className="absolute inset-0 bg-grid-pattern opacity-10" />
      
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-3 mb-12">
          <LiveIndicator />
          <h2 className="text-3xl font-bold text-center">Platform Statistics</h2>
        </div>
        
        {/* Stats Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
        
        {/* Market ticker */}
        <div className="mt-8 overflow-hidden">
          <div className="flex animate-ticker">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="flex items-center gap-8 pr-8">
                {[
                  { 
                    pair: "ALGO/USD", 
                    price: priceData?.price.toFixed(4) || "0.1060", 
                    priceINR: priceData?.priceINR?.toFixed(2) || "9.86",
                    change: priceData ? `${priceData.change24h >= 0 ? '+' : ''}${priceData.change24h.toFixed(2)}%` : "+1.30%",
                    isAlgo: true,
                  },
                  { pair: "BTC/USD", price: "67,234", change: "+1.87%", isAlgo: false },
                  { pair: "ETH/USD", price: "3,521", change: "-0.45%", isAlgo: false },
                  { pair: "SOL/USD", price: "142.50", change: "+5.12%", isAlgo: false },
                  { pair: "AVAX/USD", price: "35.20", change: "+2.33%", isAlgo: false },
                ].map((market) => (
                  <div key={`${market.pair}-${i}`} className="flex items-center gap-3 px-4 py-2 bg-dark-800/50 rounded-lg whitespace-nowrap border border-glass-border hover:border-neon-green/20 transition-colors">
                    {market.isAlgo ? (
                      <AlgoCoinBadge size="sm" showName={false} />
                    ) : null}
                    <span className="text-sm font-medium text-white">{market.pair}</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-mono text-gray-300">
                        ${market.price}
                        {'priceINR' in market && market.priceINR && <span className="text-xs text-gray-500 ml-1">(₹{market.priceINR})</span>}
                      </span>
                    </div>
                    <span className={`text-xs font-medium ${
                      market.change.startsWith('+') ? 'text-neon-green' : 'text-loss'
                    }`}>
                      {market.change}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
