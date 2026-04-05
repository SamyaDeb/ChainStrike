"use client";

import { AppLayout } from "@/components/shared/app-layout";
import { PriceDisplay, PerpOrderForm, PerpPositionsPanel, FundingRateDisplay } from "@/components/trading";
import { PriceChart } from "@/components/trading/price-chart";
import { useLivePrice } from "@/hooks/usePrice";

export default function PerpsPage() {
  const { data: priceData } = useLivePrice();
  const currentPrice = priceData?.price || 0.1;
  
  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <div className="max-w-[1920px] mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">Perpetual Trading</h1>
              <p className="text-gray-400 text-sm">Trade ALGO perpetuals with up to 20x leverage</p>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left column - Price, Chart & Positions */}
            <div className="lg:col-span-2 space-y-6">
              {/* Price and Funding side by side */}
              <div className="grid md:grid-cols-2 gap-4">
                <PriceDisplay />
                <FundingRateDisplay />
              </div>
              
              {/* Price Chart */}
              <PriceChart height={400} />
              
              {/* Order Book placeholder */}
              <div className="glass-card p-6">
                <h3 className="font-semibold mb-4">Order Book</h3>
                <div className="grid grid-cols-2 gap-4">
                  {/* Bids */}
                  <div>
                    <div className="text-xs text-gray-400 mb-2 grid grid-cols-2">
                      <span>Price</span>
                      <span className="text-right">Size</span>
                    </div>
                    {[...Array(8)].map((_, i) => {
                      const price = 0.1852 - (i + 1) * 0.0002;
                      const size = Math.floor(Math.random() * 50000) + 10000;
                      const maxSize = 60000;
                      return (
                        <div key={`bid-${i}`} className="relative py-1">
                          <div 
                            className="absolute inset-y-0 right-0 bg-profit/10"
                            style={{ width: `${(size / maxSize) * 100}%` }}
                          />
                          <div className="relative grid grid-cols-2 text-sm">
                            <span className="text-profit font-mono">{price.toFixed(4)}</span>
                            <span className="text-right font-mono text-gray-300">{size.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Asks */}
                  <div>
                    <div className="text-xs text-gray-400 mb-2 grid grid-cols-2">
                      <span>Price</span>
                      <span className="text-right">Size</span>
                    </div>
                    {[...Array(8)].map((_, i) => {
                      const price = 0.1852 + (i + 1) * 0.0002;
                      const size = Math.floor(Math.random() * 50000) + 10000;
                      const maxSize = 60000;
                      return (
                        <div key={`ask-${i}`} className="relative py-1">
                          <div 
                            className="absolute inset-y-0 left-0 bg-loss/10"
                            style={{ width: `${(size / maxSize) * 100}%` }}
                          />
                          <div className="relative grid grid-cols-2 text-sm">
                            <span className="text-loss font-mono">{price.toFixed(4)}</span>
                            <span className="text-right font-mono text-gray-300">{size.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              
              {/* Positions */}
              <PerpPositionsPanel />
            </div>
            
            {/* Right column - Order Form */}
            <div>
              <PerpOrderForm currentPrice={currentPrice} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
