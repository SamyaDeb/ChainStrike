import dynamic from "next/dynamic";
import { WalletButton } from "@/components/shared/wallet-button";
import { AlgorandLogo } from "@/components/shared/algorand-logo";
import Link from "next/link";

// Dynamic imports for landing page components (lazy loaded)
const Hero = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.Hero })), {
  ssr: true,
});
const Features = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.Features })), {
  ssr: true,
});
const HowItWorks = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.HowItWorks })), {
  ssr: true,
});
const LiveStats = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.LiveStats })), {
  ssr: true,
});
const Tokenomics = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.Tokenomics })), {
  ssr: true,
});
const CTA = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.CTA })), {
  ssr: true,
});
const Footer = dynamic(() => import("@/components/landing").then(mod => ({ default: mod.Footer })), {
  ssr: true,
});

export default function Home() {
  return (
    <div className="min-h-screen bg-dark-950">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-dark-950/80 backdrop-blur-xl border-b border-glass-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-neon-green to-neon-cyan flex items-center justify-center shadow-neon group-hover:shadow-glow-lg transition-shadow duration-300">
                  <AlgorandLogo size={20} className="text-dark-950" />
                </div>
                <span className="text-xl font-bold">
                  Chain<span className="text-neon-green">Strike</span>
                </span>
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="/trade/options" className="nav-link hover:text-neon-green">Trade</Link>
                <Link href="/pool" className="nav-link hover:text-neon-green">Pool</Link>
                <Link href="/staking" className="nav-link hover:text-neon-green">Stake</Link>
                <Link href="/governance" className="nav-link hover:text-neon-green">Govern</Link>
              </div>
            </div>
            <WalletButton />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <Hero />
      
      {/* Live Stats */}
      <LiveStats />
      
      {/* Features Grid */}
      <Features />
      
      {/* How It Works */}
      <HowItWorks />
      
      {/* Tokenomics */}
      <Tokenomics />
      
      {/* CTA */}
      <CTA />
      
      {/* Footer */}
      <Footer />
    </div>
  );
}
