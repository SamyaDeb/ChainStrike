"use client";

import { AlgorandLogo } from "@/components/shared/algorand-logo";
import { MessageCircle, Mail, ExternalLink } from "lucide-react";
import Link from "next/link";

// Custom Twitter/X icon
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// Custom GitHub icon
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

const footerLinks = {
  products: [
    { label: "Options Trading", href: "/trade/options" },
    { label: "Perpetuals", href: "/trade/perps" },
    { label: "Liquidity Pools", href: "/pool" },
    { label: "Staking", href: "/staking" },
    { label: "Governance", href: "/governance" },
  ],
  resources: [
    { label: "Documentation", href: "/docs", external: false },
    { label: "API Reference", href: "/docs/api", external: false },
    { label: "Smart Contracts", href: "https://github.com/chainstrike", external: true },
    { label: "Bug Bounty", href: "/bug-bounty", external: false },
    { label: "Brand Assets", href: "/brand", external: false },
  ],
  community: [
    { label: "Twitter", href: "https://twitter.com/chainstrike", external: true, icon: XIcon },
    { label: "Discord", href: "https://discord.gg/chainstrike", external: true, icon: MessageCircle },
    { label: "GitHub", href: "https://github.com/chainstrike", external: true, icon: GitHubIcon },
  ],
};

const legalLinks = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Risk Disclosure", href: "/risk" },
];

export function Footer() {
  return (
    <footer className="relative border-t border-glass-border">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-dark-950 to-dark-900 pointer-events-none" />
      
      <div className="relative max-w-7xl mx-auto px-4 py-16">
        {/* Main footer content */}
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-green to-neon-cyan flex items-center justify-center shadow-neon">
                <AlgorandLogo size={22} className="text-dark-950" />
              </div>
              <span className="text-2xl font-bold">
                Algo<span className="text-neon-green">DEX</span>
              </span>
            </Link>
            <p className="text-gray-400 mb-6 max-w-sm">
              The premier decentralized derivatives exchange on Algorand. 
              Trade options and perpetuals with unmatched speed and transparency.
            </p>
            
            {/* Social links */}
            <div className="flex items-center gap-3">
              {footerLinks.community.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-lg bg-dark-800 border border-glass-border flex items-center justify-center hover:border-neon-green/40 hover:bg-dark-700 transition-all group"
                >
                  <link.icon className="w-5 h-5 text-gray-400 group-hover:text-neon-green transition-colors" />
                </a>
              ))}
            </div>
          </div>
          
          {/* Products column */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Products</h4>
            <ul className="space-y-3">
              {footerLinks.products.map((link) => (
                <li key={link.label}>
                  <Link 
                    href={link.href}
                    className="text-gray-400 hover:text-neon-green transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Resources column */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Resources</h4>
            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a 
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-neon-green transition-colors text-sm inline-flex items-center gap-1"
                    >
                      {link.label}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <Link 
                      href={link.href}
                      className="text-gray-400 hover:text-neon-green transition-colors text-sm"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
          
          {/* Newsletter / Contact */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Stay Updated</h4>
            <p className="text-gray-400 text-sm mb-4">
              Subscribe to our newsletter for protocol updates and news.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Enter email"
                className="flex-1 px-4 py-2 bg-dark-800 border border-glass-border rounded-lg text-sm focus:outline-none focus:border-neon-green/50 transition-colors"
              />
              <button className="px-4 py-2 bg-neon-green hover:bg-neon-green/80 text-dark-950 rounded-lg text-sm font-medium transition-colors">
                <Mail className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Divider */}
        <div className="h-px bg-glass-border mb-8" />
        
        {/* Bottom section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Legal links */}
          <div className="flex items-center gap-6">
            {legalLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
          
          {/* Copyright */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">
              {new Date().getFullYear()} ChainStrike. All rights reserved.
            </span>
            <span className="text-xs text-gray-600">|</span>
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              Built on
              <AlgorandLogo size={12} className="text-neon-green" />
              <span className="text-neon-green font-medium">Algorand</span>
            </span>
          </div>
        </div>
        
        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-dark-800/50 rounded-lg border border-glass-border">
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            <strong className="text-gray-400">Risk Warning:</strong> Trading derivatives involves significant risk and may result in the loss of your invested capital. 
            You should not invest more than you can afford to lose and should ensure that you fully understand the risks involved. 
            Past performance is not indicative of future results. This is not financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
