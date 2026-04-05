"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/shared/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { 
  Vote, 
  Lock, 
  Coins, 
  TrendingUp, 
  Clock, 
  Wallet,
  AlertCircle,
  Gift,
  Zap,
  Loader2
} from "lucide-react";
import { getStakingStats } from "@/services/contracts";
import { PROTOCOL } from "@/config/contracts";
import { useStaking } from "@/hooks/useTrading";

// Lock period options from protocol config
const lockPeriods = PROTOCOL.STAKING.LOCK_PERIODS.map((days, i) => ({
  days,
  multiplier: PROTOCOL.STAKING.LOCK_MULTIPLIERS[i] / 10000, // Convert from basis points
  apy: 12 + (PROTOCOL.STAKING.LOCK_MULTIPLIERS[i] / 10000 - 1) * 10, // Base APY scales with multiplier
}));

interface StakingData {
  totalStaked: number;
  currentAPY: number;
  yourStake: number;
  yourRewards: number;
  lockPeriod: number;
  lockMultiplier: number;
  votingPower: number;
  lockEndTime?: number;
}

function StakingStats({ data, isLoading }: { data: StakingData; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="glass-card border-glass-border animate-pulse">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-dark-700" />
                <div className="space-y-2">
                  <div className="h-3 w-24 bg-dark-700 rounded" />
                  <div className="h-5 w-16 bg-dark-700 rounded" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neon-green/10 flex items-center justify-center">
              <Coins className="w-5 h-5 text-neon-green" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Total STRIKE Staked</p>
              <p className="text-xl font-bold font-mono">
                {data.totalStaked > 0 
                  ? `${(data.totalStaked / 1_000_000).toFixed(1)}M` 
                  : '0'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-profit/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-profit" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Current APY</p>
              <p className="text-xl font-bold font-mono text-profit">
                {data.currentAPY > 0 ? `${data.currentAPY.toFixed(1)}%` : '--'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neon-blue/10 flex items-center justify-center">
              <Vote className="w-5 h-5 text-neon-blue" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Your Voting Power</p>
              <p className="text-xl font-bold font-mono">
                {data.votingPower > 0 ? data.votingPower.toLocaleString() : '0'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="glass-card border-glass-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 flex items-center justify-center">
              <Gift className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Pending Rewards</p>
              <p className="text-xl font-bold font-mono text-profit">
                {data.yourRewards > 0 ? `+${data.yourRewards.toFixed(2)}` : '0'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StakingForm({ stakingData }: { stakingData: StakingData }) {
  const { activeAccount } = useSafeWallet();
  const { stake, unstake, isLoading, error } = useStaking();
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [amount, setAmount] = useState("");
  const [selectedLock, setSelectedLock] = useState(2); // 180 days by default
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  
  const amountNum = parseFloat(amount) || 0;
  const isStake = mode === "stake";
  const selectedPeriod = lockPeriods[selectedLock];
  
  const votingPowerPreview = amountNum * selectedPeriod.multiplier;
  const estimatedRewards = (amountNum * selectedPeriod.apy / 100 * selectedPeriod.days / 365);

  const handleStakeSubmit = async () => {
    if (!activeAccount || amountNum <= 0) {
      return;
    }

    setLastTxId(null);
    setLastError(null);

    const result = await stake({
      amount: amountNum,
      lockPeriodDays: selectedPeriod.days,
    });

    if (result.success) {
      setLastTxId(result.txId || null);
      setAmount("");
    } else {
      setLastError(result.error || "Staking transaction failed");
    }
  };

  const handleUnstakeSubmit = async () => {
    if (!activeAccount) {
      return;
    }

    setLastTxId(null);
    setLastError(null);

    const result = await unstake();
    if (result.success) {
      setLastTxId(result.txId || null);
    } else {
      setLastError(result.error || "Unstake transaction failed");
    }
  };
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Stake STRIKE</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-dark-800 rounded-lg">
          <button
            onClick={() => setMode("stake")}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              isStake
                ? "bg-neon-green text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Lock className="w-4 h-4" />
            Stake
          </button>
          <button
            onClick={() => setMode("unstake")}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              !isStake
                ? "bg-neon-green text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Coins className="w-4 h-4" />
            Unstake
          </button>
        </div>
        
        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Amount</label>
            <span className="text-xs text-gray-500">
              {isStake 
                ? "Balance: -- STRIKE" 
                : `Staked: ${stakingData.yourStake > 0 ? stakingData.yourStake.toLocaleString() : '0'} STRIKE`}
            </span>
          </div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg pl-4 pr-28 font-mono text-lg focus:outline-none focus:border-neon-green/50 transition-colors"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button 
                onClick={() => setAmount(isStake ? "0" : stakingData.yourStake.toString())}
                className="px-2 py-1 text-xs bg-dark-600 rounded hover:bg-dark-500 transition-colors"
              >
                MAX
              </button>
              <span className="text-gray-400 text-sm">STRIKE</span>
            </div>
          </div>
        </div>
        
        {/* Lock Period Selection (only for staking) */}
        {isStake && (
          <div>
            <label className="block text-sm text-gray-400 mb-3">Lock Period</label>
            <div className="space-y-2">
              {lockPeriods.map((period, i) => (
                <button
                  key={period.days}
                  onClick={() => setSelectedLock(i)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                    selectedLock === i
                      ? "bg-neon-green/10 border-neon-green"
                      : "border-glass-border hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Clock className={`w-4 h-4 ${selectedLock === i ? "text-neon-green" : "text-gray-400"}`} />
                    <span className="font-medium">
                      {period.days === 0 
                        ? "No lock" 
                        : period.days < 365 
                          ? `${period.days} days` 
                          : `${period.days / 365} year${period.days > 365 ? "s" : ""}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-400">{period.multiplier}x voting</span>
                    <span className="text-profit font-mono">{period.apy.toFixed(1)}% APY</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Preview */}
        {amountNum > 0 && isStake && (
          <div className="bg-dark-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Voting Power</span>
              <span className="font-mono">{votingPowerPreview.toLocaleString()} veSTRIKE</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Lock Multiplier</span>
              <span className="font-mono">{selectedPeriod.multiplier}x</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Est. Rewards ({selectedPeriod.days}d)</span>
              <span className="font-mono text-profit">+{estimatedRewards.toFixed(2)} STRIKE</span>
            </div>
          </div>
        )}
        
        {/* Submit */}
        {!activeAccount ? (
          <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
            <AlertCircle className="w-4 h-4" />
            Connect wallet to {isStake ? "stake" : "unstake"}
          </div>
        ) : (
          <Button 
            onClick={isStake ? handleStakeSubmit : handleUnstakeSubmit}
            disabled={isLoading || (isStake ? amountNum <= 0 : false)}
            className="w-full gap-2"
            size="lg"
          >
            <Wallet className="w-4 h-4" />
            {isLoading
              ? "Processing..."
              : isStake
                ? "Stake STRIKE"
                : "Unstake STRIKE"}
          </Button>
        )}

        {(error || lastError) && (
          <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/20 rounded-lg text-sm text-loss">
            <AlertCircle className="w-4 h-4" />
            {lastError || error}
          </div>
        )}

        {lastTxId && (
          <div className="flex items-center gap-2 p-3 bg-profit/10 border border-profit/20 rounded-lg text-sm text-profit">
            <AlertCircle className="w-4 h-4" />
            Transaction submitted: {lastTxId.slice(0, 8)}...{lastTxId.slice(-8)}
          </div>
        )}
        
        {isStake && (
          <p className="text-xs text-gray-500 text-center">
            Staked tokens will be locked for the selected period
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function YourStakeInfo({ stakingData, isLoading }: { stakingData: StakingData; isLoading: boolean }) {
  const { activeAccount } = useSafeWallet();
  const { claimRewards, isLoading: claimingRewards, error } = useStaking();
  const [claimTxId, setClaimTxId] = useState<string | null>(null);

  const handleClaimRewards = async () => {
    setClaimTxId(null);
    const result = await claimRewards();
    if (result.success) {
      setClaimTxId(result.txId || null);
    }
  };
  
  if (!activeAccount) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="glass-card border-glass-border animate-pulse">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Your Stake</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-dark-800 rounded-lg p-4 h-24" />
            <div className="bg-dark-800 rounded-lg p-4 h-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate days remaining if there's a lock end time
  const daysRemaining = stakingData.lockEndTime 
    ? Math.max(0, Math.ceil((stakingData.lockEndTime - Date.now() / 1000) / 86400))
    : 0;

  if (stakingData.yourStake === 0) {
    return (
      <Card className="glass-card border-glass-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Your Stake</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-400">
            <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>You have no staked STRIKE</p>
            <p className="text-sm mt-1">Stake to earn rewards and voting power</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Your Stake</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-dark-800 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-1">Staked Amount</p>
            <p className="text-xl font-bold font-mono">{stakingData.yourStake.toLocaleString()}</p>
            <p className="text-xs text-gray-500">STRIKE</p>
          </div>
          <div className="bg-dark-800 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-1">Lock Ends</p>
            <p className="text-xl font-bold font-mono">
              {daysRemaining > 0 ? `${daysRemaining}d` : 'Unlocked'}
            </p>
            <p className="text-xs text-gray-500">{daysRemaining > 0 ? 'remaining' : 'ready to withdraw'}</p>
          </div>
        </div>
        
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Claimable Rewards</span>
            <span className="text-xl font-bold font-mono text-profit">
              +{stakingData.yourRewards.toFixed(2)} STRIKE
            </span>
          </div>
          <Button
            size="sm"
            className="w-full gap-2"
            disabled={stakingData.yourRewards <= 0 || claimingRewards}
            onClick={handleClaimRewards}
          >
            <Gift className="w-4 h-4" />
            {claimingRewards ? "Claiming..." : "Claim Rewards"}
          </Button>
          {claimTxId && (
            <p className="text-xs text-profit mt-2">
              Claim submitted: {claimTxId.slice(0, 8)}...{claimTxId.slice(-8)}
            </p>
          )}
          {error && (
            <p className="text-xs text-loss mt-2">{error}</p>
          )}
        </div>
        
        {stakingData.lockMultiplier > 1 && (
          <div className="bg-neon-green/5 rounded-lg p-4 border border-neon-green/20">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-neon-green" />
              <span className="font-medium">Boost Active</span>
            </div>
            <p className="text-sm text-gray-400">
              Your {stakingData.lockMultiplier}x multiplier gives you {stakingData.votingPower.toLocaleString()} voting power
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StakingPage() {
  const { activeAccount } = useSafeWallet();
  const [isLoading, setIsLoading] = useState(true);
  const [stakingData, setStakingData] = useState<StakingData>({
    totalStaked: 0,
    currentAPY: 0,
    yourStake: 0,
    yourRewards: 0,
    lockPeriod: 0,
    lockMultiplier: 1,
    votingPower: 0,
  });

  useEffect(() => {
    async function fetchStakingData() {
      setIsLoading(true);
      try {
        const stats = await getStakingStats(activeAccount?.address);
        
        // Calculate voting power based on stake and lock multiplier
        const lockIndex = PROTOCOL.STAKING.LOCK_PERIODS.findIndex(
          p => p === (stats.lockPeriod || 0)
        );
        const multiplier = lockIndex >= 0 
          ? PROTOCOL.STAKING.LOCK_MULTIPLIERS[lockIndex] / 10000 
          : 1;
        
        setStakingData({
          totalStaked: stats.totalStaked,
          currentAPY: stats.apr > 0 ? stats.apr / 100 : 18.5, // Default APY if contract returns 0
          yourStake: stats.yourStaked,
          yourRewards: stats.rewards,
          lockPeriod: stats.lockPeriod || 0,
          lockMultiplier: multiplier,
          votingPower: stats.yourStaked * multiplier,
        });
      } catch (error) {
        console.error('Error fetching staking data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchStakingData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchStakingData, 30000);
    return () => clearInterval(interval);
  }, [activeAccount?.address]);

  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <div className="max-w-[1920px] mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Staking</h1>
              <p className="text-gray-400 text-sm">Stake STRIKE to earn rewards and participate in governance</p>
            </div>
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            )}
          </div>
          
          {/* Stats */}
          <StakingStats data={stakingData} isLoading={isLoading} />
          
          <div className="grid lg:grid-cols-3 gap-6 mt-6">
            {/* Left column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Info banner */}
              <Card className="glass-card border-glass-border bg-gradient-to-r from-neon-green/5 to-neon-blue/5">
                <CardContent className="py-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-neon-green/10 flex items-center justify-center flex-shrink-0">
                      <Vote className="w-6 h-6 text-neon-green" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Vote-Escrowed STRIKE (veSTRIKE)</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">
                        Lock your STRIKE tokens to receive veSTRIKE, which grants voting power in protocol governance 
                        and boosts your staking rewards. Longer lock periods provide higher multipliers up to 3x.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Your stake info */}
              <YourStakeInfo stakingData={stakingData} isLoading={isLoading} />
              
              {/* Lock multipliers info */}
              <Card className="glass-card border-glass-border">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Lock Period Benefits</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-glass-border">
                          <th className="text-left py-3 text-gray-400 font-medium">Lock Period</th>
                          <th className="text-center py-3 text-gray-400 font-medium">Multiplier</th>
                          <th className="text-center py-3 text-gray-400 font-medium">APY</th>
                          <th className="text-right py-3 text-gray-400 font-medium">Voting Power</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lockPeriods.map((period) => (
                          <tr key={period.days} className="border-b border-glass-border last:border-0">
                            <td className="py-3 font-medium">
                              {period.days === 0 
                                ? "No lock" 
                                : period.days < 365 
                                  ? `${period.days} days` 
                                  : `${period.days / 365} year${period.days > 365 ? "s" : ""}`}
                            </td>
                            <td className="py-3 text-center">
                              <span className="px-2 py-1 bg-neon-green/10 text-neon-green rounded text-xs font-mono">
                                {period.multiplier}x
                              </span>
                            </td>
                            <td className="py-3 text-center font-mono text-profit">{period.apy.toFixed(1)}%</td>
                            <td className="py-3 text-right font-mono">1,000 = {(1000 * period.multiplier).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Right column - Staking form */}
            <div>
              <StakingForm stakingData={stakingData} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
