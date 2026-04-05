"use client";

import { Coins, Lock, Users, Gift, Flame, PiggyBank } from "lucide-react";

const tokenDistribution = [
  { label: "Liquidity Mining", percentage: 40, color: "bg-neon-green", icon: PiggyBank },
  { label: "Community Treasury", percentage: 25, color: "bg-neon-cyan", icon: Users },
  { label: "Team & Advisors", percentage: 15, color: "bg-neon-green/60", icon: Lock },
  { label: "Early Contributors", percentage: 10, color: "bg-neon-cyan/60", icon: Gift },
  { label: "Protocol Development", percentage: 10, color: "bg-neon-mint", icon: Flame },
];

const tokenStats = [
  { label: "Total Supply", value: "1,000,000,000", suffix: "STRIKE" },
  { label: "Circulating Supply", value: "125,000,000", suffix: "STRIKE" },
  { label: "Staking APY", value: "12-45", suffix: "%" },
  { label: "Governance Power", value: "1:1", suffix: "Vote" },
];

const tokenUtility = [
  {
    title: "Governance",
    description: "Vote on protocol upgrades, fee structures, and new market listings",
    icon: Users,
  },
  {
    title: "Staking Rewards",
    description: "Stake STRIKE to earn protocol revenue and boost your LP yields",
    icon: Coins,
  },
  {
    title: "Fee Discounts",
    description: "Hold STRIKE for reduced trading fees across all markets",
    icon: Gift,
  },
  {
    title: "Vesting Locks",
    description: "Lock tokens for up to 4 years for maximum voting power (3x multiplier)",
    icon: Lock,
  },
];

function DistributionBar() {
  return (
    <div className="relative">
      {/* Progress bar */}
      <div className="h-6 rounded-full bg-dark-700 overflow-hidden flex">
        {tokenDistribution.map((item) => {
          const style = { width: `${item.percentage}%` };
          
          return (
            <div
              key={item.label}
              className={`h-full ${item.color} first:rounded-l-full last:rounded-r-full relative group`}
              style={style}
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-dark-700 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-glass-border">
                <span className="font-medium">{item.label}</span>
                <span className="text-gray-400 ml-2">{item.percentage}%</span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-6">
        {tokenDistribution.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${item.color}`} />
            <span className="text-sm text-gray-400">{item.label}</span>
            <span className="text-sm font-medium text-white">{item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tokenomics() {
  return (
    <section className="py-24 px-4 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-neon-green/5 rounded-full blur-3xl" />
      
      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neon-green/10 border border-neon-green/20 mb-6">
            <Coins className="w-4 h-4 text-neon-green" />
            <span className="text-sm text-gray-300">STRIKE Token</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Tokenomics
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            STRIKE is the governance and utility token powering the ChainStrike protocol.
          </p>
        </div>
        
        {/* Token stats */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {tokenStats.map((stat) => (
            <div key={stat.label} className="glass-card p-6 text-center">
              <p className="text-3xl font-bold gradient-text-static font-mono mb-1">
                {stat.value}
              </p>
              <p className="text-sm text-gray-400">{stat.label}</p>
              <p className="text-xs text-neon-green mt-1">{stat.suffix}</p>
            </div>
          ))}
        </div>
        
        {/* Distribution */}
        <div className="glass-card p-8 mb-16">
          <h3 className="text-2xl font-bold text-center mb-8">Token Distribution</h3>
          <DistributionBar />
        </div>
        
        {/* Token utility */}
        <div className="mb-8">
          <h3 className="text-2xl font-bold text-center mb-8">Token Utility</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {tokenUtility.map((utility) => (
              <div key={utility.title} className="glass-card p-6 group hover:border-neon-green/20 transition-all duration-300">
                <div className="w-12 h-12 rounded-xl bg-neon-green/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <utility.icon className="w-6 h-6 text-neon-green" />
                </div>
                <h4 className="text-lg font-semibold mb-2">{utility.title}</h4>
                <p className="text-sm text-gray-400">{utility.description}</p>
              </div>
            ))}
          </div>
        </div>
        
        {/* Vesting schedule note */}
        <div className="text-center">
          <p className="text-sm text-gray-500">
            Team and advisor tokens are subject to 4-year vesting with 1-year cliff.
            <br />
            <span className="text-neon-green">All token unlocks are transparent and on-chain.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
