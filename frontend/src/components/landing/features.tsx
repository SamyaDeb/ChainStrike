"use client";

import { Card, CardContent } from "@/components/ui/card";
import { 
  TrendingUp, 
  BarChart3, 
  Coins, 
  Shield, 
  Zap, 
  Vote,
  ArrowUpRight,
  Lock,
  Gauge
} from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: TrendingUp,
    title: "Options Trading",
    description: "Trade CALL and PUT options with flexible strikes and user-defined expiries. Hedge your portfolio or speculate on price movements.",
    gradient: "from-neon-green to-neon-cyan",
    iconColor: "text-neon-green",
    link: "/trade/options",
    stats: [
      { label: "Strike Range", value: "Custom" },
      { label: "Expiry", value: "Flexible" },
    ],
  },
  {
    icon: BarChart3,
    title: "Perpetual Contracts",
    description: "Trade perpetuals with up to 20x leverage. Long or short any market with no expiry dates and continuous funding.",
    gradient: "from-neon-cyan to-neon-blue",
    iconColor: "text-neon-cyan",
    link: "/trade/perps",
    stats: [
      { label: "Max Leverage", value: "20x" },
      { label: "Funding", value: "8h" },
    ],
  },
  {
    icon: Coins,
    title: "Liquidity Pools",
    description: "Provide liquidity and earn passive yield from trading fees, option premiums, and funding rate payments.",
    gradient: "from-neon-green to-neon-mint",
    iconColor: "text-neon-green",
    link: "/pool",
    stats: [
      { label: "Est. APY", value: "12-25%" },
      { label: "Auto-compound", value: "Yes" },
    ],
  },
  {
    icon: Shield,
    title: "Non-Custodial",
    description: "Your funds stay in your control. Smart contracts handle all escrow and settlement transparently on-chain.",
    gradient: "from-neon-cyan to-neon-green",
    iconColor: "text-neon-cyan",
    link: null,
    stats: [
      { label: "Audited", value: "Yes" },
      { label: "Open Source", value: "Yes" },
    ],
  },
  {
    icon: Zap,
    title: "Instant Settlement",
    description: "Built on Algorand for instant finality. Trades settle in under 4 seconds with minimal fees.",
    gradient: "from-neon-green to-neon-yellow",
    iconColor: "text-neon-green",
    link: null,
    stats: [
      { label: "Finality", value: "~3.3s" },
      { label: "Fees", value: "< $0.01" },
    ],
  },
  {
    icon: Vote,
    title: "DAO Governance",
    description: "Stake STRIKE tokens to participate in governance, vote on protocol upgrades, and earn staking rewards.",
    gradient: "from-neon-cyan to-neon-green",
    iconColor: "text-neon-cyan",
    link: "/staking",
    stats: [
      { label: "Voting Power", value: "1:1" },
      { label: "Lock Bonus", value: "Up to 3x" },
    ],
  },
];

function FeatureCard({ 
  feature 
}: { 
  feature: typeof features[0] 
}) {
  const content = (
    <Card className="feature-card group h-full relative overflow-hidden">
      {/* Gradient border effect on hover */}
      <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-[0.06] transition-opacity duration-500`} />
      
      <CardContent className="relative pt-6 pb-6 h-full flex flex-col">
        {/* Icon */}
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} p-[1px] mb-5`}>
          <div className="w-full h-full rounded-2xl bg-dark-800 flex items-center justify-center group-hover:bg-dark-700 transition-colors">
            <feature.icon className={`w-7 h-7 ${feature.iconColor}`} />
          </div>
        </div>
        
        {/* Title with arrow */}
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-xl font-semibold">{feature.title}</h3>
          {feature.link && (
            <ArrowUpRight className="w-4 h-4 text-gray-500 group-hover:text-neon-green group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
          )}
        </div>
        
        {/* Description */}
        <p className="text-gray-400 text-sm leading-relaxed mb-5 flex-grow">
          {feature.description}
        </p>
        
        {/* Stats */}
        <div className="flex items-center gap-4 pt-4 border-t border-glass-border">
          {feature.stats.map((stat) => (
            <div key={stat.label} className="flex-1">
              <p className="text-xs text-gray-500 mb-0.5">{stat.label}</p>
              <p className="text-sm font-semibold text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
  
  if (feature.link) {
    return (
      <Link href={feature.link} className="block h-full">
        {content}
      </Link>
    );
  }
  
  return content;
}

export function Features() {
  return (
    <section className="py-24 px-4 relative">
      {/* Background accent */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-dark-900/50 to-transparent pointer-events-none" />
      
      <div className="relative max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neon-cyan/10 border border-neon-cyan/20 mb-6">
            <Gauge className="w-4 h-4 text-neon-cyan" />
            <span className="text-sm text-gray-300">Full-Featured DeFi Platform</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Everything You Need to{" "}
            <span className="gradient-text">Trade</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            A complete suite of decentralized derivatives products built for traders of all levels.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
        
        {/* Additional highlights */}
        <div className="mt-16 grid md:grid-cols-3 gap-6">
          {[
            { icon: Lock, label: "Self-Custody", desc: "Always control your funds" },
            { icon: Shield, label: "Battle-Tested", desc: "Secure smart contracts" },
            { icon: Zap, label: "Low Latency", desc: "Sub-second response times" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50 border border-glass-border hover:border-neon-green/20 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-neon-green/10 flex items-center justify-center">
                <item.icon className="w-5 h-5 text-neon-green" />
              </div>
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
