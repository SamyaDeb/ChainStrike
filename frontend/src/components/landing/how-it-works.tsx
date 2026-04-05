"use client";

import { Wallet, MousePointer, TrendingUp, Banknote } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Wallet,
    title: "Connect Wallet",
    description: "Connect your Pera, Defly, or any Algorand-compatible wallet to get started.",
    color: "green",
    colorClass: "neon-green",
  },
  {
    number: "02",
    icon: MousePointer,
    title: "Choose Your Market",
    description: "Select from options or perpetual contracts. Pick your asset, direction, and size.",
    color: "cyan",
    colorClass: "neon-cyan",
  },
  {
    number: "03",
    icon: TrendingUp,
    title: "Execute Trade",
    description: "Place your trade with instant execution. All settlements happen on-chain in seconds.",
    color: "green",
    colorClass: "neon-green",
  },
  {
    number: "04",
    icon: Banknote,
    title: "Manage & Profit",
    description: "Monitor positions in real-time. Close trades or let them settle automatically.",
    color: "cyan",
    colorClass: "neon-cyan",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-4 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-dark-900" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/30 to-transparent" />
      
      <div className="relative max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            How It{" "}
            <span className="gradient-text">Works</span>
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto text-lg">
            Start trading derivatives in minutes. No KYC, no intermediaries.
          </p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connection line */}
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-neon-green via-neon-cyan to-neon-green hidden lg:block" style={{ transform: 'translateY(-50%)' }} />
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <div key={step.number} className="relative group">
                {/* Card */}
                <div className="relative bg-dark-800/80 border border-glass-border rounded-2xl p-6 hover:border-neon-green/20 transition-all duration-300 h-full">
                  {/* Step number */}
                  <div className="absolute -top-4 left-6">
                    <span className={`text-5xl font-bold text-${step.colorClass}/20`}>
                      {step.number}
                    </span>
                  </div>
                  
                  {/* Icon circle */}
                  <div className={`relative w-16 h-16 rounded-2xl bg-gradient-to-br from-${step.colorClass}/20 to-transparent border border-${step.colorClass}/30 flex items-center justify-center mb-6 mt-4 group-hover:scale-110 transition-transform`}>
                    <step.icon className={`w-8 h-8 text-${step.colorClass}`} />
                    
                    {/* Pulse effect */}
                    <div className={`absolute inset-0 rounded-2xl bg-${step.colorClass}/10 animate-ping opacity-0 group-hover:opacity-100`} />
                  </div>
                  
                  {/* Content */}
                  <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {step.description}
                  </p>
                </div>
                
                {/* Arrow connector */}
                {index < steps.length - 1 && (
                  <div className="absolute top-1/2 -right-4 w-8 h-8 hidden lg:flex items-center justify-center z-10">
                    <div className="w-3 h-3 rounded-full bg-dark-800 border-2 border-neon-green" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-400 mb-4">
            Ready to get started? It only takes a minute.
          </p>
          <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-neon-green/10 to-neon-cyan/10 border border-neon-green/20">
            <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
            <span className="text-sm">
              <span className="text-white font-medium">892</span>
              <span className="text-gray-400"> traders already using ChainStrike</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
