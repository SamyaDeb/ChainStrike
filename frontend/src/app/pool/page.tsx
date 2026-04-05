"use client";

import { useState } from "react";
import { AppLayout } from "@/components/shared/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { 
  Droplets, 
  TrendingUp, 
  Wallet, 
  ArrowDownUp, 
  Info, 
  PieChart,
  Percent,
  AlertCircle,
  Activity,
  RefreshCw,
  DollarSign,
  TrendingDown
} from "lucide-react";
import { usePoolData } from "@/hooks/usePoolData";
import { usePoolOperations } from "@/hooks/useTrading";
import { PROTOCOL } from "@/config/contracts";
import type { PoolData as PoolDataType } from "@/types/pool";

// Pool overview data for UI display
interface PoolOverviewData {
  totalDeposits: number;
  sharePrice: number;
  utilizationRate: number;
  apy: {
    options: number;
    perps: number;
    total: number;
  };
  yourDeposit: number;
  yourShares: number;
  yourEarnings: number;
  totalPremiumsEarned: number;  // Combined premiums from all pools
  totalPayouts: number;         // Combined payouts from all pools
  
  // Separate pool data
  optionsPool: PoolDataType | null;
  perpsPool: PoolDataType | null;
}

function PoolStatsDisplay({ data, loading }: { data: PoolOverviewData; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="glass-card border-glass-border animate-pulse">
            <CardContent className="pt-6">
              <div className="h-16 bg-dark-700 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-neon-green/10 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-neon-green" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Total Value Locked</p>
              <p className="text-2xl font-bold font-mono">
                {data.totalDeposits > 1000 
                  ? `${(data.totalDeposits / 1000).toFixed(1)}K ALGO`
                  : `${data.totalDeposits.toFixed(2)} ALGO`
                }
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-profit/10 flex items-center justify-center">
              <Percent className="w-5 h-5 text-neon-green" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Combined APY</p>
              <p className="text-2xl font-bold font-mono text-neon-green">{data.apy.total.toFixed(1)}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">Options: {data.apy.options.toFixed(1)}%</span>
            <span className="text-gray-500">Perps: {data.apy.perps.toFixed(1)}%</span>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-neon-blue/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-neon-blue" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Utilization Rate</p>
              <p className="text-2xl font-bold font-mono">{data.utilizationRate.toFixed(1)}%</p>
            </div>
          </div>
          <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-neon-blue"
              style={{ width: `${Math.min(100, data.utilizationRate)}%` }}
            />
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Share Price</p>
              <p className="text-2xl font-bold font-mono">{data.sharePrice.toFixed(4)} ALGO</p>
            </div>
          </div>
          <p className="text-xs text-neon-green">+{((data.sharePrice - 1) * 100).toFixed(2)}% since launch</p>
        </CardContent>
      </Card>
      
      {/* Premiums Earned Card */}
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-profit/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-profit" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Premiums Earned</p>
              <p className="text-2xl font-bold font-mono text-profit">
                {data.totalPremiumsEarned > 1000 
                  ? `${(data.totalPremiumsEarned / 1000).toFixed(2)}K ALGO`
                  : `${data.totalPremiumsEarned.toFixed(4)} ALGO`
                }
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500">Cumulative from all pools</p>
        </CardContent>
      </Card>
      
      {/* Total Payouts Card */}
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-loss/10 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-loss" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Total Payouts</p>
              <p className="text-2xl font-bold font-mono text-loss">
                {data.totalPayouts > 1000 
                  ? `${(data.totalPayouts / 1000).toFixed(2)}K ALGO`
                  : `${data.totalPayouts.toFixed(4)} ALGO`
                }
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500">Paid to traders</p>
        </CardContent>
      </Card>
    </div>
  );
}

function DepositWithdrawForm({ 
  poolData, 
  onTransactionComplete 
}: { 
  poolData: PoolOverviewData;
  onTransactionComplete?: () => Promise<void>;
}) {
  const { activeAccount } = useSafeWallet();
  const { deposit, withdraw, isLoading, error } = usePoolOperations();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [selectedPool, setSelectedPool] = useState<"options" | "perps">("options");
  const [amount, setAmount] = useState("");
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  
  const amountNum = parseFloat(amount) || 0;
  const isDeposit = mode === "deposit";
  
  // Get the correct pool data for share price calculation
  const currentPool = selectedPool === 'options' ? poolData.optionsPool : poolData.perpsPool;
  const sharePrice = currentPool?.sharePrice || 1;
  const userShares = currentPool?.userPosition?.shares || 0;
  
  // Calculate preview
  const sharesToReceive = isDeposit ? amountNum / sharePrice : 0;
  const algoToReceive = !isDeposit ? amountNum * sharePrice : 0;
  const totalShares = (currentPool?.totalShares || 0);
  const poolShare = totalShares > 0 ? (sharesToReceive / (totalShares + sharesToReceive)) * 100 : 0;

  // Minimum deposit validation
  const minDeposit = selectedPool === 'perps' 
    ? PROTOCOL.POOLS.PERPS_MIN_DEPOSIT / 1_000_000  // 10 ALGO for perps
    : PROTOCOL.POOLS.MIN_DEPOSIT / 1_000_000;        // 1 ALGO for options
  const isBelowMinimum = isDeposit && amountNum > 0 && amountNum < minDeposit;

  const handleSubmit = async () => {
    if (!activeAccount || amountNum <= 0) {
      return;
    }

    setLastTxId(null);
    setLastError(null);

    const result = isDeposit
      ? await deposit({ pool: selectedPool, amount: amountNum })
      : await withdraw({ pool: selectedPool, shares: amountNum });

    if (result.success) {
      setLastTxId(result.txId || null);
      setAmount("");
      // Trigger refresh of pool data after successful transaction
      if (onTransactionComplete) {
        await onTransactionComplete();
      }
    } else {
      setLastError(result.error || "Transaction failed");
    }
  };
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Manage Position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pool Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-dark-800 rounded-lg">
          <button
            onClick={() => setSelectedPool("options")}
            className={`py-2 text-sm rounded-md font-medium transition-colors ${
              selectedPool === "options" ? "bg-dark-600 text-white shadow-sm" : "text-gray-400 hover:text-white"
            }`}
          >
            Options Pool
          </button>
          <button
            onClick={() => setSelectedPool("perps")}
            className={`py-2 text-sm rounded-md font-medium transition-colors ${
              selectedPool === "perps" ? "bg-dark-600 text-white shadow-sm" : "text-gray-400 hover:text-white"
            }`}
          >
            Perps Pool
          </button>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-dark-800 rounded-lg">
          <button
            onClick={() => setMode("deposit")}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              isDeposit
                ? "bg-neon-green text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Droplets className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => setMode("withdraw")}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              !isDeposit
                ? "bg-neon-green text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <ArrowDownUp className="w-4 h-4" />
            Withdraw
          </button>
        </div>
        
        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">
              {isDeposit ? "Deposit Amount" : "Shares to Withdraw"}
            </label>
            <span className="text-xs text-gray-500">
              {isDeposit ? "Balance: Connect wallet" : `Shares: ${userShares.toFixed(2)}`}
            </span>
          </div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg pl-4 pr-24 font-mono text-lg focus:outline-none focus:border-neon-green/50 transition-colors"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button 
                onClick={() => setAmount(isDeposit ? "100" : userShares.toString())}
                className="px-2 py-1 text-xs bg-dark-600 rounded hover:bg-dark-500 transition-colors"
              >
                MAX
              </button>
              <span className="text-gray-400 text-sm">{isDeposit ? "ALGO" : selectedPool === 'options' ? 'csOPT' : 'csPERP'}</span>
            </div>
          </div>
        </div>
        
        {/* Preview */}
        {amountNum > 0 && (
          <div className="bg-dark-800 rounded-lg p-4 space-y-3">
            {isDeposit ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">You will receive</span>
                  <span className="font-mono">{sharesToReceive.toFixed(4)} {selectedPool === 'options' ? 'csOPT' : 'csPERP'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Share price</span>
                  <span className="font-mono">{sharePrice.toFixed(4)} ALGO</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 flex items-center gap-1">
                    Pool share
                    <Info className="w-3 h-3" />
                  </span>
                  <span className="font-mono">{poolShare.toFixed(4)}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">You will receive</span>
                  <span className="font-mono">{algoToReceive.toFixed(4)} ALGO</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Withdrawal fee</span>
                  <span className="font-mono text-loss">0.00 ALGO</span>
                </div>
              </>
            )}
          </div>
        )}
        
        {/* Submit */}
        {isBelowMinimum && (
          <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
            <AlertCircle className="w-4 h-4" />
            Minimum deposit is {minDeposit} ALGO for {selectedPool === 'perps' ? 'Perpetuals' : 'Options'} Pool
          </div>
        )}
        
        {!activeAccount ? (
          <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
            <AlertCircle className="w-4 h-4" />
            Connect wallet to {isDeposit ? "deposit" : "withdraw"}
          </div>
        ) : (
          <Button 
            onClick={handleSubmit}
            disabled={amountNum <= 0 || isLoading || isBelowMinimum}
            className="w-full gap-2"
            size="lg"
          >
            <Wallet className="w-4 h-4" />
            {isLoading
              ? "Processing..."
              : isDeposit
                ? "Deposit to Pool"
                : "Withdraw from Pool"}
          </Button>
        )}

        {(error || lastError) && (
          <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/20 rounded-lg text-sm text-loss">
            <AlertCircle className="w-4 h-4" />
            {lastError || error}
          </div>
        )}

        {lastTxId && (
          <div className="flex items-center gap-2 p-3 bg-profit/10 border border-profit/20 rounded-lg text-sm text-neon-green">
            <AlertCircle className="w-4 h-4" />
            Transaction submitted: {lastTxId.slice(0, 8)}...{lastTxId.slice(-8)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PositionCardProps {
  poolName: string;
  poolData: PoolDataType | null;
  tokenSymbol: string;
  lastUpdate: number;
  onRefresh: () => void;
  loading?: boolean;
}

function PositionCard({ 
  poolName, 
  poolData, 
  tokenSymbol, 
  lastUpdate,
  onRefresh,
  loading = false 
}: PositionCardProps) {
  const position = poolData?.userPosition;
  
  // Calculate time since last update
  const secondsSinceUpdate = Math.floor((Date.now() - lastUpdate) / 1000);
  const timeAgo = secondsSinceUpdate < 60 
    ? `${secondsSinceUpdate}s ago`
    : `${Math.floor(secondsSinceUpdate / 60)}m ago`;
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{poolName}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {lastUpdate > 0 && (
          <p className="text-xs text-gray-500">Updated {timeAgo}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!position ? (
          <div className="bg-dark-800 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-400">No position in this pool</p>
            <p className="text-xs text-gray-500 mt-1">Deposit to start earning</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-dark-800 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Deposited</p>
                <p className="text-2xl font-bold font-mono">{position.depositedValue.toFixed(2)}</p>
                <p className="text-xs text-gray-500">ALGO</p>
              </div>
              <div className="bg-dark-800 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">LP Tokens</p>
                <p className="text-2xl font-bold font-mono">{position.shares.toFixed(2)}</p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
              </div>
            </div>
            
            <div className="bg-dark-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Current Value</span>
                <span className="text-xl font-bold font-mono">
                  {position.currentValue.toFixed(2)} ALGO
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Earnings</span>
                <span className={`font-mono ${position.earnings >= 0 ? 'text-neon-green' : 'text-red-400'}`}>
                  {position.earnings >= 0 ? '+' : ''}{position.earnings.toFixed(4)} ALGO
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Pool Share</span>
                <span className="text-gray-300 font-mono">{position.shareOfPool.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Pool APY</span>
                <span className="text-neon-green font-mono">+{poolData.apy.toFixed(1)}%</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function YourPositions({ 
  optionsPool, 
  perpsPool, 
  lastUpdate, 
  onRefresh, 
  loading 
}: { 
  optionsPool: PoolDataType | null;
  perpsPool: PoolDataType | null;
  lastUpdate: number;
  onRefresh: () => void;
  loading: boolean;
}) {
  const { activeAccount } = useSafeWallet();
  
  if (!activeAccount) {
    return (
      <Card className="glass-card border-glass-border">
        <CardContent className="py-12 text-center">
          <Wallet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
          <p className="text-gray-400 text-sm">Connect your wallet to view your positions</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Your Positions</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <PositionCard
          poolName="Options Pool"
          poolData={optionsPool}
          tokenSymbol="csOPT"
          lastUpdate={lastUpdate}
          onRefresh={onRefresh}
          loading={loading}
        />
        <PositionCard
          poolName="Perps Pool"
          poolData={perpsPool}
          tokenSymbol="csPERP"
          lastUpdate={lastUpdate}
          onRefresh={onRefresh}
          loading={loading}
        />
      </div>
    </div>
  );
}

export default function PoolPage() {
  const { activeAccount } = useSafeWallet();
  const activeAddress = activeAccount?.address;
  
  // Use the new pool data hook
  const { 
    optionsPool, 
    perpsPool, 
    loading, 
    lastUpdate, 
    refresh,
    onTransactionComplete 
  } = usePoolData(activeAddress);

  // Calculate combined stats for the overview display
  const totalLiquidity = (optionsPool?.totalLiquidity || 0) + (perpsPool?.totalLiquidity || 0);
  const avgUtilization = ((optionsPool?.utilizationRate || 0) + (perpsPool?.utilizationRate || 0)) / 2;
  const avgApy = ((optionsPool?.apy || 0) + (perpsPool?.apy || 0)) / 2;
  
  // Calculate combined premiums and payouts
  const totalPremiumsEarned = (optionsPool?.totalEarnings || 0) + (perpsPool?.totalEarnings || 0);
  const totalPayouts = (optionsPool?.totalPayouts || 0) + (perpsPool?.totalPayouts || 0);
  
  // Calculate user totals
  const optionsUserValue = optionsPool?.userPosition?.currentValue || 0;
  const perpsUserValue = perpsPool?.userPosition?.currentValue || 0;
  const totalUserValue = optionsUserValue + perpsUserValue;

  const poolOverviewData = {
    totalDeposits: totalLiquidity,
    sharePrice: optionsPool?.sharePrice || perpsPool?.sharePrice || 1,
    utilizationRate: avgUtilization,
    apy: {
      options: optionsPool?.apy || 0,
      perps: perpsPool?.apy || 0,
      total: avgApy,
    },
    yourDeposit: totalUserValue,
    yourShares: 0, // Not used anymore
    yourEarnings: (optionsPool?.userPosition?.earnings || 0) + (perpsPool?.userPosition?.earnings || 0),
    totalPremiumsEarned,
    totalPayouts,
    optionsPool,
    perpsPool,
  };

  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <div className="max-w-[1920px] mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Liquidity Pool</h1>
            <p className="text-gray-400 text-sm">Provide liquidity and earn passive yield from trading activity</p>
          </div>
          
          {/* Pool Stats */}
          <PoolStatsDisplay data={poolOverviewData} loading={loading} />
          
          <div className="grid lg:grid-cols-3 gap-6 mt-6">
            {/* Left column */}
            <div className="lg:col-span-2 space-y-6">

              {/* Your Positions - now shows separate cards */}
              <YourPositions 
                optionsPool={optionsPool}
                perpsPool={perpsPool}
                lastUpdate={lastUpdate}
                onRefresh={refresh}
                loading={loading}
              />
            </div>
            
            {/* Right column - Deposit/Withdraw */}
            <div>
              <DepositWithdrawForm poolData={poolOverviewData} onTransactionComplete={onTransactionComplete} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
