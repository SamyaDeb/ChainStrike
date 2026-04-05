"use client";

import { AppLayout } from "@/components/shared/app-layout";
import { PriceDisplay, OptionOrderForm, OptionChain, PositionsPanel } from "@/components/trading";
import { PriceChart } from "@/components/trading/price-chart";
import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import { useLivePrice } from "@/hooks/usePrice";

export default function OptionsPage() {
  const { data: priceData } = useLivePrice();
  const currentPrice = priceData?.price || 0.1;
  const [viewMode, setViewMode] = useState<"chain" | "simple">("simple");
  
  const handleSelectOption = () => {
    // Will be implemented when connecting to smart contracts
  };
  
  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <div className="max-w-[1920px] mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">Options Trading</h1>
              <p className="text-gray-400 text-sm">Trade ALGO options with flexible strikes and expiries</p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("simple")}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === "simple" 
                    ? "bg-neon-green/10 text-neon-green" 
                    : "text-gray-400 hover:text-white hover:bg-glass"
                }`}
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode("chain")}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === "chain" 
                    ? "bg-neon-green/10 text-neon-green" 
                    : "text-gray-400 hover:text-white hover:bg-glass"
                }`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {viewMode === "simple" ? (
            /* Simple View - Order Form + Price */
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left column - Price & Positions */}
              <div className="lg:col-span-2 space-y-6">
                <PriceDisplay />
                
                {/* Price Chart */}
                <PriceChart height={400} />
                
                {/* Positions */}
                <PositionsPanel />
              </div>
              
              {/* Right column - Order Form */}
              <div>
                <OptionOrderForm 
                  currentPrice={currentPrice}
                />
              </div>
            </div>
          ) : (
            /* Chain View - Full Option Chain */
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <OptionChain 
                  currentPrice={currentPrice}
                  onSelectOption={handleSelectOption}
                />
              </div>
              
              <div className="space-y-6">
                <PriceDisplay />
                <OptionOrderForm currentPrice={currentPrice} />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
