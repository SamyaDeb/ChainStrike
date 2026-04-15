"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, TrendingUp, Shield } from "lucide-react";
import { AlgoCoinBadge } from "@/components/shared/algorand-logo";
import Link from "next/link";
import { useEffect, useState } from "react";

// Animated counter hook
function useAnimatedCounter(end: number, duration: number = 2000, prefix: string = "", suffix: string = "") {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    let startTime: number;
    let animationFrame: number;
    
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(easeOutQuart * end));
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };
    
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);
  
  return `${prefix}${count.toLocaleString()}${suffix}`;
}

// Floating orb component
function FloatingOrb({ 
  className, 
  delay = 0 
}: { 
  className: string; 
  delay?: number 
}) {
  return (
    <div 
      className={`absolute rounded-full blur-3xl opacity-20 animate-float ${className}`}
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

// Animated grid background
function GridBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-hero-glow" />
      
      {/* Grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0, 255, 136, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 255, 136, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      
      {/* Floating orbs */}
      <FloatingOrb 
        className="w-96 h-96 bg-neon-green -top-20 -left-20" 
        delay={0} 
      />
      <FloatingOrb 
        className="w-80 h-80 bg-neon-cyan top-1/3 -right-20" 
        delay={2} 
      />
      <FloatingOrb 
        className="w-64 h-64 bg-neon-green/50 bottom-20 left-1/4" 
        delay={4} 
      />
    </div>
  );
}

// Live price ticker
function PriceTicker() {
  const [price, setPrice] = useState(0.185);
  const [change, setChange] = useState(3.24);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setPrice(prev => {
        const delta = (Math.random() - 0.5) * 0.002;
        return Math.max(0.1, prev + delta);
      });
      setChange(prev => {
        const delta = (Math.random() - 0.5) * 0.1;
        return prev + delta;
      });
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="inline-flex items-center gap-4 px-5 py-2.5 rounded-full bg-dark-800/80 border border-neon-green/20 backdrop-blur-sm">
      <AlgoCoinBadge size="sm" showName={true} />
      <span className="text-sm font-mono text-white">${price.toFixed(4)}</span>
      <span className={`text-sm font-medium ${change >= 0 ? 'text-neon-green' : 'text-loss'}`}>
        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
      </span>
    </div>
  );
}

// Stat card with animation
function StatCard({ 
  label, 
  value, 
  prefix = "", 
  suffix = "" 
}: { 
  label: string; 
  value: number; 
  prefix?: string; 
  suffix?: string;
}) {
  const animatedValue = useAnimatedCounter(value, 2500, prefix, suffix);
  
  return (
    <div className="glass-card p-6 group hover:border-neon-green/20 transition-all duration-300 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-green/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <p className="relative text-3xl md:text-4xl font-bold gradient-text-static mb-1">
        {animatedValue}
      </p>
      <p className="relative text-sm text-gray-400">{label}</p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 px-4 overflow-hidden">
      <GridBackground />
      
      <div className="relative max-w-7xl mx-auto">
        {/* Badge */}
        <div className="flex justify-center mb-6 animate-fade-in">
          <PriceTicker />
        </div>
        
        {/* Main heading */}
        <div className="text-center mb-8 animate-slide-up">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight tracking-tight">
            Trade Derivatives
            <br />
            <span className="gradient-text">On-Chain</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-10">
            Options and perpetuals with up to <span className="text-white font-semibold">20x leverage</span>. 
            Non-custodial, transparent, and instant finality on Algorand.
          </p>
        </div>
        
        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <Link href="/trade/options">
            <Button size="lg" className="gap-2 text-lg px-8 py-6 shadow-neon hover:shadow-glow-lg transition-all duration-300">
              Start Trading
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <Link href="/pool">
            <Button variant="outline" size="lg" className="text-lg px-8 py-6">
              Provide Liquidity
            </Button>
          </Link>
        </div>
        
        {/* Feature pills */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-16 animate-fade-in" style={{ animationDelay: '0.4s' }}>
          {[
            { icon: TrendingUp, text: "Options & Perps" },
            { icon: Zap, text: "< 4s Settlement" },
            { icon: Shield, text: "Non-Custodial" },
          ].map((item) => (
            <div 
              key={item.text}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-dark-800/60 border border-glass-border hover:border-neon-green/20 transition-colors"
            >
              <item.icon className="w-4 h-4 text-neon-green" />
              <span className="text-sm text-gray-300">{item.text}</span>
            </div>
          ))}
        </div>
        
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto animate-slide-up" style={{ animationDelay: '0.6s' }}>
          <StatCard label="Total Value Locked" value={2400000} prefix="$" suffix="" />
          <StatCard label="24h Volume" value={12800000} prefix="$" suffix="" />
          <StatCard label="Total Trades" value={48200} prefix="" suffix="+" />
          <StatCard label="Active Traders" value={892} prefix="" suffix="" />
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-1/4 left-10 w-px h-32 bg-gradient-to-b from-transparent via-neon-green/40 to-transparent hidden lg:block" />
        <div className="absolute top-1/3 right-10 w-px h-24 bg-gradient-to-b from-transparent via-neon-cyan/40 to-transparent hidden lg:block" />
      </div>
    </section>
  );
}
