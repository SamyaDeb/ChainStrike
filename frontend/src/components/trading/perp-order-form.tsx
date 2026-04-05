"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PositionSide } from "@/types/perp";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Wallet,
  Gauge,
  Loader2,
  Check,
} from "lucide-react";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { usePerpsTrading } from "@/hooks/useTrading";
import { EXPLORER } from "@/config/networks";

interface PerpOrderFormProps {
  currentPrice: number;
  onSubmit?: (order: PerpOrder) => void;
}

interface PerpOrder {
  side: PositionSide;
  margin: number;
  leverage: number;
  size: number;
}

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 15, 20];

export function PerpOrderForm({ currentPrice, onSubmit }: PerpOrderFormProps) {
  const { activeAccount } = useSafeWallet();
  const { openPosition, isLoading, error } = usePerpsTrading();
  const [side, setSide] = useState<PositionSide>(PositionSide.LONG);
  const [margin, setMargin] = useState<string>("100");
  const [leverage, setLeverage] = useState<number>(5);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  console.log("[PerpOrderForm] Render state:", {
    hasActiveAccount: !!activeAccount,
    hasOpenPosition: !!openPosition,
    isLoading,
    error,
    side,
    margin,
    leverage,
  });

  const marginNum = parseFloat(margin) || 0;
  const positionSize = marginNum * leverage;
  const isLong = side === PositionSide.LONG;

  // Calculate liquidation price
  const maintenanceMargin = 0.05; // 5%
  const liquidationPrice = isLong
    ? currentPrice * (1 - 1 / leverage + maintenanceMargin)
    : currentPrice * (1 + 1 / leverage - maintenanceMargin);

  // Calculate PnL for +/- 10% move
  const pnlPlus10 = 0.1 * positionSize * (isLong ? 1 : -1);
  const pnlMinus10 = -0.1 * positionSize * (isLong ? 1 : -1);

  // Funding rate (mock)
  const fundingRate = 0.0012; // 0.12%
  const fundingPayment = positionSize * fundingRate * (isLong ? -1 : 1);

  const handleSubmit = async () => {
    console.log("[PerpOrderForm] handleSubmit called", {
      activeAccount: !!activeAccount,
      marginNum,
      leverage,
      isLong,
    });

    if (!activeAccount || marginNum <= 0) {
      console.log(
        "[PerpOrderForm] Early return - no account or invalid margin",
      );
      return;
    }

    setTxSuccess(null);

    console.log("[PerpOrderForm] Calling openPosition...");
    const result = await openPosition({
      side: isLong ? "long" : "short",
      margin: marginNum,
      leverage,
    });
    console.log("[PerpOrderForm] openPosition result:", result);

    if (result.success && result.txId) {
      setTxSuccess(result.txId);
      onSubmit?.({
        side,
        margin: marginNum,
        leverage,
        size: positionSize,
      });
    }
  };

  return (
    <Card className="glass-card border-glass-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Trade Perpetuals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Side Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-dark-800 rounded-lg">
          <button
            type="button"
            onClick={() => {
              console.log("[PerpOrderForm] Setting side to LONG");
              setSide(PositionSide.LONG);
            }}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              isLong
                ? "bg-profit text-white shadow-neon-green"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Long
          </button>
          <button
            type="button"
            onClick={() => {
              console.log("[PerpOrderForm] Setting side to SHORT");
              setSide(PositionSide.SHORT);
            }}
            className={`flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
              !isLong ? "bg-loss text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            Short
          </button>
        </div>

        {/* Margin Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Margin</label>
            <span className="text-xs text-gray-500">Min: 10 ALGO</span>
          </div>
          <div className="relative">
            <input
              type="number"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              placeholder="0.00"
              className="w-full h-12 bg-dark-700 border border-glass-border rounded-lg pl-4 pr-20 font-mono text-lg focus:outline-none focus:border-neon-green/50 transition-colors"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button
                onClick={() => setMargin("100")}
                className="px-2 py-1 text-xs bg-dark-600 rounded hover:bg-dark-500 transition-colors"
              >
                100
              </button>
              <span className="text-gray-400 text-sm">ALGO</span>
            </div>
          </div>

          {/* Quick amount buttons */}
          <div className="flex gap-2 mt-2">
            {[10, 50, 100, 500].map((amt) => (
              <button
                key={amt}
                onClick={() => setMargin(amt.toString())}
                className="flex-1 py-1.5 text-xs bg-dark-700 rounded hover:bg-dark-600 transition-colors"
              >
                {amt}
              </button>
            ))}
          </div>
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400 flex items-center gap-1">
              <Gauge className="w-4 h-4" />
              Leverage
            </label>
            <span className="text-lg font-bold text-neon-green">
              {leverage}x
            </span>
          </div>

          {/* Leverage buttons */}
          <div className="grid grid-cols-6 gap-2">
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                className={`py-2 rounded-lg text-sm font-medium transition-all border ${
                  leverage === lev
                    ? "bg-neon-green/20 border-neon-green text-white"
                    : "border-glass-border text-gray-400 hover:border-gray-500"
                }`}
              >
                {lev}x
              </button>
            ))}
          </div>

          {/* Slider */}
          <div className="mt-3">
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full h-2 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-neon-green"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1x</span>
              <span>20x</span>
            </div>
          </div>

          {leverage >= 10 && (
            <div className="flex items-center gap-2 p-2 mt-2 bg-warning/10 border border-warning/20 rounded-lg text-xs text-warning">
              <AlertTriangle className="w-4 h-4" />
              High leverage increases liquidation risk
            </div>
          )}
        </div>

        {/* Position Size */}
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Position Size</span>
            <span className="font-mono font-semibold text-white">
              {positionSize.toFixed(2)} ALGO
            </span>
          </div>
          <div className="text-xs text-gray-500">
            ≈ ${(positionSize * currentPrice).toFixed(2)} USD
          </div>
        </div>

        {/* Order Details */}
        <div className="bg-dark-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Entry Price</span>
            <span className="font-mono">${currentPrice.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400 flex items-center gap-1">
              Liquidation Price
              <Info className="w-3 h-3" />
            </span>
            <span className="font-mono text-loss">
              ${liquidationPrice.toFixed(4)}
            </span>
          </div>
          <div className="h-px bg-glass-border" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Est. Funding (8h)</span>
            <span
              className={`font-mono ${fundingPayment >= 0 ? "text-profit" : "text-loss"}`}
            >
              {fundingPayment >= 0 ? "+" : ""}
              {fundingPayment.toFixed(4)} ALGO
            </span>
          </div>
          <div className="h-px bg-glass-border" />
          <div className="text-xs text-gray-500">
            <p className="mb-1">Estimated P&L:</p>
            <div className="flex items-center justify-between">
              <span>Price +10%</span>
              <span className={pnlPlus10 >= 0 ? "text-profit" : "text-loss"}>
                {pnlPlus10 >= 0 ? "+" : ""}
                {pnlPlus10.toFixed(2)} ALGO
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Price -10%</span>
              <span className={pnlMinus10 >= 0 ? "text-profit" : "text-loss"}>
                {pnlMinus10 >= 0 ? "+" : ""}
                {pnlMinus10.toFixed(2)} ALGO
              </span>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/20 rounded-lg text-sm text-loss">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* Success Message */}
        {txSuccess && (
          <div className="flex items-center gap-2 p-3 bg-profit/10 border border-profit/20 rounded-lg text-sm text-profit">
            <Check className="w-4 h-4 flex-shrink-0" />
            <div>
              <span>Position opened!</span>
              <a
                href={EXPLORER.tx(txSuccess)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs underline mt-1"
              >
                View on Explorer
              </a>
            </div>
          </div>
        )}

        {/* Submit Button */}
        {!activeAccount ? (
          <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
            <AlertTriangle className="w-4 h-4" />
            Connect wallet to trade
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => {
              console.log("[PerpOrderForm] Button clicked!");
              handleSubmit();
            }}
            disabled={marginNum < 10 || isLoading}
            className={`w-full gap-2 ${
              isLong
                ? "bg-profit hover:bg-profit/90"
                : "bg-loss hover:bg-loss/90"
            }`}
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4" />
                Open {isLong ? "Long" : "Short"} Position
              </>
            )}
          </Button>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-gray-500 text-center">
          Trading with leverage involves significant risk of loss.
        </p>
      </CardContent>
    </Card>
  );
}
