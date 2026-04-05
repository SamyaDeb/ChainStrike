"use client";

import { AppLayout } from "@/components/shared/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { useState, useEffect } from "react";
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  PieChart, 
  BarChart2, 
  Droplets,
  ArrowUpRight,
  ArrowDownRight,
  Loader2
} from "lucide-react";
import Link from "next/link";
import { getPortfolioSummary, getOptionsPoolStats, getPerpsPoolStats, Position } from "@/services/contracts";

// Portfolio data interface
interface PortfolioData {
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  breakdown: {
    wallet: number;
    options: number;
    perps: number;
    pool: number;
  };
  optionPositions: Array<{ id: number; type: string; strike: number; expiry: string; qty: number; pnl: number; pnlPercent: number }>;
  perpPositions: Array<{ id: number; side: string; size: number; leverage: number; entryPrice: number; pnl: number; pnlPercent: number }>;
  poolPosition: {
    deposited: number;
    currentValue: number;
    shares: number;
    earnings: number;
    apy: number;
  };
}

// Default empty portfolio
const emptyPortfolio: PortfolioData = {
  totalValue: 0,
  totalPnL: 0,
  totalPnLPercent: 0,
  breakdown: { wallet: 0, options: 0, perps: 0, pool: 0 },
  optionPositions: [],
  perpPositions: [],
  poolPosition: { deposited: 0, currentValue: 0, shares: 0, earnings: 0, apy: 0 },
};

function PortfolioOverview({ data }: { data: PortfolioData }) {
  const isProfitable = data.totalPnL >= 0;
  const optionsPnL = data.optionPositions.reduce((sum, p) => sum + p.pnl, 0);
  const perpsPnL = data.perpPositions.reduce((sum, p) => sum + p.pnl, 0);
  
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="glass-card border-glass-border sm:col-span-2">
        <CardContent className="pt-6">
          <p className="text-sm text-gray-400 mb-2">Total Portfolio Value</p>
          <p className="text-4xl font-bold font-mono mb-2">
            {data.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })} ALGO
          </p>
          <div className={`flex items-center gap-2 ${isProfitable ? "text-profit" : "text-loss"}`}>
            {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-mono">
              {isProfitable ? "+" : ""}{data.totalPnL.toFixed(2)} ALGO
            </span>
            <span className="text-sm">
              ({isProfitable ? "+" : ""}{data.totalPnLPercent.toFixed(1)}%)
            </span>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-profit" />
            <span className="text-sm text-gray-400">Options P&L</span>
          </div>
          <p className={`text-2xl font-bold font-mono ${optionsPnL >= 0 ? "text-profit" : "text-loss"}`}>
            {optionsPnL >= 0 ? "+" : ""}{optionsPnL.toFixed(2)} ALGO
          </p>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <BarChart2 className="w-4 h-4 text-neon-blue" />
            <span className="text-sm text-gray-400">Perps P&L</span>
          </div>
          <p className={`text-2xl font-bold font-mono ${perpsPnL >= 0 ? "text-profit" : "text-loss"}`}>
            {perpsPnL >= 0 ? "+" : ""}{perpsPnL.toFixed(2)} ALGO
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AllocationChart({ data }: { data: PortfolioData }) {
  const total = Object.values(data.breakdown).reduce((a, b) => a + b, 0) || 1;
  const allocations = [
    { label: "Wallet", value: data.breakdown.wallet, color: "bg-gray-500", percent: (data.breakdown.wallet / total * 100) },
    { label: "Options", value: data.breakdown.options, color: "bg-neon-green", percent: (data.breakdown.options / total * 100) },
    { label: "Perpetuals", value: data.breakdown.perps, color: "bg-neon-blue", percent: (data.breakdown.perps / total * 100) },
    { label: "Liquidity Pool", value: data.breakdown.pool, color: "bg-neon-cyan", percent: (data.breakdown.pool / total * 100) },
  ];
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <PieChart className="w-5 h-5 text-neon-green" />
          Portfolio Allocation
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Bar chart */}
        <div className="h-4 rounded-full overflow-hidden flex mb-6 bg-dark-700">
          {allocations.filter(a => a.percent > 0).map((item) => (
            <div 
              key={item.label}
              className={`${item.color} first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${item.percent}%` }}
            />
          ))}
        </div>
        
        {/* Legend */}
        <div className="grid grid-cols-2 gap-4">
          {allocations.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${item.color}`} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{item.label}</span>
                  <span className="text-sm font-mono">{item.percent.toFixed(1)}%</span>
                </div>
                <p className="text-xs text-gray-500 font-mono">{item.value.toLocaleString()} ALGO</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OptionPositions({ positions }: { positions: PortfolioData['optionPositions'] }) {
  if (positions.length === 0) {
    return (
      <Card className="glass-card border-glass-border">
        <CardContent className="py-8 text-center">
          <TrendingUp className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No option positions</p>
          <Link href="/trade/options">
            <Button variant="outline" size="sm" className="mt-4">
              Trade Options
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Option Positions</CardTitle>
          <Link href="/trade/options" className="text-xs text-neon-green hover:underline">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {positions.map((pos) => (
            <div key={pos.id} className="flex items-center justify-between p-3 bg-dark-800 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  pos.type === "CALL" ? "bg-profit/10" : "bg-loss/10"
                }`}>
                  {pos.type === "CALL" ? (
                    <ArrowUpRight className="w-4 h-4 text-profit" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-loss" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {pos.type} ${pos.strike.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {pos.qty} contracts exp {pos.expiry}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-mono text-sm ${pos.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ALGO
                </p>
                <p className={`text-xs ${pos.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  ({pos.pnlPercent >= 0 ? "+" : ""}{pos.pnlPercent.toFixed(1)}%)
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PerpPositions({ positions }: { positions: PortfolioData['perpPositions'] }) {
  if (positions.length === 0) {
    return (
      <Card className="glass-card border-glass-border">
        <CardContent className="py-8 text-center">
          <BarChart2 className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No perpetual positions</p>
          <Link href="/trade/perps">
            <Button variant="outline" size="sm" className="mt-4">
              Trade Perpetuals
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Perp Positions</CardTitle>
          <Link href="/trade/perps" className="text-xs text-neon-green hover:underline">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {positions.map((pos) => (
            <div key={pos.id} className="flex items-center justify-between p-3 bg-dark-800 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  pos.side === "LONG" ? "bg-profit/10" : "bg-loss/10"
                }`}>
                  {pos.side === "LONG" ? (
                    <TrendingUp className="w-4 h-4 text-profit" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-loss" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {pos.side} {pos.leverage}x
                  </p>
                  <p className="text-xs text-gray-500">
                    {pos.size} ALGO @ ${pos.entryPrice.toFixed(4)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-mono text-sm ${pos.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ALGO
                </p>
                <p className={`text-xs ${pos.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  ({pos.pnlPercent >= 0 ? "+" : ""}{pos.pnlPercent.toFixed(1)}%)
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PoolPosition({ data }: { data: PortfolioData['poolPosition'] }) {
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Pool Position</CardTitle>
          <Link href="/pool" className="text-xs text-neon-green hover:underline">
            Manage
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="p-4 bg-dark-800 rounded-lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-neon-cyan/10 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <p className="font-semibold">{data.currentValue.toFixed(2)} ALGO</p>
              <p className="text-xs text-gray-500">{data.shares.toFixed(2)} csALGO</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Earnings</p>
              <p className="text-profit font-mono">+{data.earnings.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-400">APY</p>
              <p className="text-profit font-mono">{data.apy.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectWalletPrompt() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="glass-card border-glass-border max-w-md w-full">
        <CardContent className="py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-neon-green/10 flex items-center justify-center mx-auto mb-6">
            <Wallet className="w-10 h-10 text-neon-green" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-6">
            Connect your Algorand wallet to view your portfolio and start trading
          </p>
          <Button size="lg" className="gap-2">
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-neon-cyan" />
        <p className="text-gray-400">Loading portfolio data from contracts...</p>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { activeAccount } = useSafeWallet();
  const activeAddress = activeAccount?.address;
  const [portfolioData, setPortfolioData] = useState<PortfolioData>(emptyPortfolio);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPortfolioData() {
      if (!activeAddress) {
        setPortfolioData(emptyPortfolio);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Fetch data from contracts
        const [summary, optionsPool, perpsPool] = await Promise.all([
          getPortfolioSummary(activeAddress),
          getOptionsPoolStats(activeAddress),
          getPerpsPoolStats(activeAddress),
        ]);

        // Convert to portfolio format
        const optionPositions = summary.optionPositions.map((p: Position, i: number) => ({
          id: i + 1,
          type: p.optionType === 'call' ? 'CALL' : 'PUT',
          strike: p.strike || 0,
          expiry: p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A',
          qty: Math.floor(p.size),
          pnl: p.pnl,
          pnlPercent: p.pnlPercent,
        }));

        const perpPositions = summary.perpPositions.map((p: Position, i: number) => ({
          id: i + 1,
          side: p.side === 'long' ? 'LONG' : 'SHORT',
          size: p.size,
          leverage: 5, // Default leverage
          entryPrice: p.entryPrice,
          pnl: p.pnl,
          pnlPercent: p.pnlPercent,
        }));

        const optionsValue = optionPositions.reduce((sum: number, p: { pnl: number }) => sum + p.pnl, 0);
        const perpsValue = perpPositions.reduce((sum: number, p: { pnl: number }) => sum + p.pnl, 0);
        const optionsPoolValue = optionsPool.userPosition?.currentValue || 0;
        const perpsPoolValue = perpsPool.userPosition?.currentValue || 0;
        const poolValue = optionsPoolValue + perpsPoolValue;

        setPortfolioData({
          totalValue: summary.totalValue,
          totalPnL: summary.totalPnL,
          totalPnLPercent: summary.totalValue > 0 ? (summary.totalPnL / summary.totalValue) * 100 : 0,
          breakdown: {
            wallet: 0, // Would need to fetch wallet balance separately
            options: optionsValue,
            perps: perpsValue,
            pool: poolValue,
          },
          optionPositions,
          perpPositions,
          poolPosition: {
            deposited: (optionsPool.userPosition?.depositedValue || 0) + (perpsPool.userPosition?.depositedValue || 0),
            currentValue: poolValue,
            shares: (optionsPool.userPosition?.shares || 0) + (perpsPool.userPosition?.shares || 0),
            earnings: (optionsPool.userPosition?.earnings || 0) + (perpsPool.userPosition?.earnings || 0),
            apy: (optionsPool.apy + perpsPool.apy) / 2,
          },
        });
      } catch (error) {
        console.error('Error fetching portfolio data:', error);
        setPortfolioData(emptyPortfolio);
      } finally {
        setLoading(false);
      }
    }

    fetchPortfolioData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchPortfolioData, 30000);
    return () => clearInterval(interval);
  }, [activeAddress]);
  
  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <div className="max-w-[1920px] mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Portfolio</h1>
            <p className="text-gray-400 text-sm">Track all your positions and performance</p>
          </div>
          
          {!activeAccount ? (
            <ConnectWalletPrompt />
          ) : loading ? (
            <LoadingState />
          ) : (
            <>
              {/* Overview */}
              <PortfolioOverview data={portfolioData} />
              
              <div className="grid lg:grid-cols-3 gap-6 mt-6">
                {/* Left column */}
                <div className="lg:col-span-2 space-y-6">
                  <AllocationChart data={portfolioData} />
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <OptionPositions positions={portfolioData.optionPositions} />
                    <PerpPositions positions={portfolioData.perpPositions} />
                  </div>
                </div>
                
                {/* Right column */}
                <div className="space-y-6">
                  <PoolPosition data={portfolioData.poolPosition} />
                  
                  {/* Quick actions */}
                  <Card className="glass-card border-glass-border">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-lg">Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Link href="/trade/options" className="block">
                        <Button variant="outline" className="w-full justify-start gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Trade Options
                        </Button>
                      </Link>
                      <Link href="/trade/perps" className="block">
                        <Button variant="outline" className="w-full justify-start gap-2">
                          <BarChart2 className="w-4 h-4" />
                          Trade Perpetuals
                        </Button>
                      </Link>
                      <Link href="/pool" className="block">
                        <Button variant="outline" className="w-full justify-start gap-2">
                          <Droplets className="w-4 h-4" />
                          Manage Liquidity
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
