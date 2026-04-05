"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Wallet, Zap, Shield } from "lucide-react";
import Link from "next/link";

export function CTA() {
  return (
    <section className="py-24 px-4 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-r from-neon-green/5 via-neon-cyan/5 to-neon-green/5" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/40 to-transparent" />
      
      {/* Floating elements */}
      <div className="absolute top-10 left-10 w-32 h-32 bg-neon-green/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-10 right-10 w-40 h-40 bg-neon-cyan/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
      
      <div className="relative max-w-4xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neon-green/10 border border-neon-green/20 mb-8">
          <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          <span className="text-sm text-neon-green font-medium">Live on TestNet</span>
        </div>
        
        {/* Heading */}
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
          Ready to Start{" "}
          <span className="gradient-text">Trading?</span>
        </h2>
        
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Connect your wallet and experience the future of decentralized derivatives trading. 
          No KYC, no intermediaries, just pure on-chain trading.
        </p>
        
        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <Link href="/trade/options">
            <Button size="lg" className="gap-2 text-lg px-8 py-6 shadow-neon hover:shadow-glow-lg transition-all duration-300">
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <Link href="https://docs.chainstrike.io" target="_blank">
            <Button variant="outline" size="lg" className="text-lg px-8 py-6">
              Read Documentation
            </Button>
          </Link>
        </div>
        
        {/* Trust indicators */}
        <div className="flex flex-wrap items-center justify-center gap-8">
          {[
            { icon: Shield, label: "Audited Smart Contracts" },
            { icon: Wallet, label: "Self-Custody Always" },
            { icon: Zap, label: "Instant Settlement" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-gray-400">
              <item.icon className="w-5 h-5 text-neon-green" />
              <span className="text-sm">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
