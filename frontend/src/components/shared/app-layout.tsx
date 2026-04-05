"use client";

import { WalletButton } from "@/components/shared/wallet-button";
import { AlgorandLogo } from "@/components/shared/algorand-logo";
import { TrendingUp, BarChart3, Droplets, PieChart, Vote, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navLinks = [
  { href: "/trade/options", label: "Options", icon: TrendingUp },
  { href: "/trade/perps", label: "Perpetuals", icon: BarChart3 },
  { href: "/pool", label: "Pool", icon: Droplets },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/staking", label: "Stake", icon: Vote },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-dark-950">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-dark-950/95 backdrop-blur-xl border-b border-glass-border">
        <div className="max-w-[1920px] mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-neon-green to-neon-cyan flex items-center justify-center shadow-neon group-hover:shadow-glow-lg transition-shadow duration-300">
                  <AlgorandLogo size={20} className="text-dark-950" />
                </div>
                <span className="text-xl font-bold hidden sm:block">
                  Chain<span className="text-neon-green">Strike</span>
                </span>
              </Link>
              
              {/* Desktop nav */}
              <div className="hidden md:flex items-center gap-1">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href || pathname?.startsWith(link.href + "/");
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? "bg-neon-green/10 text-neon-green"
                          : "text-gray-400 hover:text-white hover:bg-glass"
                      }`}
                    >
                      <link.icon className="w-4 h-4" />
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              <WalletButton />
              
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-lg hover:bg-glass"
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-glass-border bg-dark-900">
            <div className="px-4 py-3 space-y-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? "bg-neon-green/10 text-neon-green"
                        : "text-gray-400 hover:text-white hover:bg-glass"
                    }`}
                  >
                    <link.icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="pt-16">
        {children}
      </main>
    </div>
  );
}
