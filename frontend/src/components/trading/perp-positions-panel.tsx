"use client";

import { PerpPosition, PositionSide, PositionStatus } from "@/types/perp";
import {
  TrendingUp,
  TrendingDown,
  MoreVertical,
  DollarSign,
  AlertTriangle,
  Edit,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback } from "react";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { getPerpPositions } from "@/services/contracts";
import { usePerpsTrading } from "@/hooks/useTrading";

interface PerpPositionWithPnL extends PerpPosition {
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  liquidationPrice: number;
  marginRatio: number;
}

interface PerpPositionsPanelProps {
  positions?: PerpPositionWithPnL[];
}

export function PerpPositionsPanel({
  positions: propPositions,
}: PerpPositionsPanelProps) {
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [positions, setPositions] = useState<PerpPositionWithPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [closingPositionId, setClosingPositionId] = useState<number | null>(
    null,
  );
  const [takeProfitPositionId, setTakeProfitPositionId] = useState<
    number | null
  >(null);
  const { activeAccount } = useSafeWallet();
  const activeAddress = activeAccount?.address;
  const { closePosition, isLoading: tradingLoading } = usePerpsTrading();

  const fetchPositions = useCallback(async () => {
    if (propPositions) {
      setPositions(propPositions);
      setLoading(false);
      return;
    }

    if (!activeAddress) {
      setPositions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log(
        "[PerpPositionsPanel] Fetching positions for:",
        activeAddress,
      );
      const contractPositions = await getPerpPositions(activeAddress);
      console.log("[PerpPositionsPanel] Got positions:", contractPositions);

      // Convert contract positions to component format
      const formattedPositions: PerpPositionWithPnL[] = contractPositions.map(
        (p) => {
          const sizeAlgo = p.size;
          const collateralAlgo = sizeAlgo / (p.entryPrice > 0 ? 5 : 1); // Estimate collateral
          const leverageX = 5; // Default estimate

          return {
            id: Number(p.id) || 0,
            owner: activeAddress,
            side: p.side === "long" ? PositionSide.LONG : PositionSide.SHORT,
            size: BigInt(Math.floor(sizeAlgo * 1_000_000)),
            margin: BigInt(Math.floor(collateralAlgo * 1_000_000)),
            leverage: leverageX * 100, // scaled
            entryPrice: BigInt(Math.floor(p.entryPrice * 1_000_000)),
            lastFundingTime: p.timestamp
              ? p.timestamp - 3600000
              : Date.now() - 3600000,
            accumulatedFunding: BigInt(0),
            openedAt: p.timestamp || Date.now() - 86400000,
            status: PositionStatus.OPEN,
            currentPrice: p.currentPrice,
            unrealizedPnL: p.pnl,
            unrealizedPnLPercent: p.pnlPercent,
            liquidationPrice: p.liquidationPrice || 0,
            marginRatio: 2100, // ~21% margin ratio estimate
          };
        },
      );

      setPositions(formattedPositions);
    } catch (error) {
      console.error("[PerpPositionsPanel] Error fetching positions:", error);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [activeAddress, propPositions]);

  // Fetch positions on mount and when address changes
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions, refreshKey]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeAddress && !propPositions) {
        fetchPositions();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [activeAddress, propPositions, fetchPositions]);

  // Listen for position updates (triggered by successful trades)
  useEffect(() => {
    const handlePositionUpdate = () => {
      console.log(
        "[PerpPositionsPanel] Position update event received, refreshing...",
      );
      // Clear cache and refetch
      if (typeof window !== "undefined") {
        localStorage.removeItem("chainstrike_perp_positions");
      }
      setRefreshKey((k) => k + 1);
    };

    window.addEventListener(
      "chainstrike:position-update",
      handlePositionUpdate,
    );
    return () =>
      window.removeEventListener(
        "chainstrike:position-update",
        handlePositionUpdate,
      );
  }, []);

  const handleRefresh = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("chainstrike_perp_positions");
    }
    setRefreshKey((k) => k + 1);
  };

  const handleClosePosition = async (positionId: number) => {
    if (!activeAddress) {
      alert("Please connect your wallet");
      return;
    }

    // Confirm close
    if (!confirm("Are you sure you want to close this position?")) {
      return;
    }

    setClosingPositionId(positionId);
    try {
      const result = await closePosition(positionId.toString());
      if (result.success) {
        console.log("Position closed successfully!", {
          txId: result.txId,
        });

        // Clear cache and refresh positions
        if (typeof window !== "undefined") {
          localStorage.removeItem("chainstrike_perp_positions");
        }
        setRefreshKey((k) => k + 1);

        alert(`Position closed successfully! Transaction ID: ${result.txId}`);
      } else {
        console.error("Failed to close position:", result.error);
        alert(`Failed to close position: ${result.error}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Error closing position:", errorMessage, err);
      alert(`Error closing position: ${errorMessage}`);
    } finally {
      setClosingPositionId(null);
    }
  };

  const handleTakeProfit = async (
    positionId: number,
    unrealizedPnL: number,
  ) => {
    if (!activeAddress) {
      alert("Please connect your wallet");
      return;
    }

    // Only allow take profit if position is profitable
    if (unrealizedPnL <= 0) {
      alert(
        "Cannot take profit on a losing position. Current P&L is negative.",
      );
      return;
    }

    // Confirm take profit
    if (
      !confirm(
        `Take profit and close this position? You will realize a profit of ${unrealizedPnL.toFixed(2)} ALGO.`,
      )
    ) {
      return;
    }

    setTakeProfitPositionId(positionId);
    try {
      const result = await closePosition(positionId.toString());
      if (result.success) {
        console.log("Profit taken successfully!", {
          txId: result.txId,
          profit: unrealizedPnL,
        });

        // Clear cache and refresh positions
        if (typeof window !== "undefined") {
          localStorage.removeItem("chainstrike_perp_positions");
        }
        setRefreshKey((k) => k + 1);

        alert(
          `Profit taken successfully! Realized ${unrealizedPnL.toFixed(2)} ALGO. Transaction ID: ${result.txId}`,
        );
      } else {
        console.error("Failed to take profit:", result.error);
        alert(`Failed to take profit: ${result.error}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Error taking profit:", errorMessage, err);
      alert(`Error taking profit: ${errorMessage}`);
    } finally {
      setTakeProfitPositionId(null);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-neon-cyan" />
        <p className="text-gray-400">Loading positions...</p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-dark-700 flex items-center justify-center mx-auto mb-4">
          <DollarSign className="w-8 h-8 text-gray-500" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Open Positions</h3>
        <p className="text-gray-400 text-sm">
          Your perpetual positions will appear here once you open a trade.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-glass-border flex items-center justify-between">
        <h3 className="font-semibold">Open Positions</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {positions.length} active
          </span>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 rounded hover:bg-glass text-gray-400 hover:text-white transition-colors"
            title="Refresh positions"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="divide-y divide-glass-border">
        {positions.map((position) => {
          const isLong = position.side === PositionSide.LONG;
          const isProfitable = position.unrealizedPnL >= 0;
          const isRisky = position.marginRatio < 1500; // Less than 15% margin ratio
          const size = Number(position.size) / 1000000;
          const leverage = position.leverage / 100;
          const entryPrice = Number(position.entryPrice) / 1000000;

          return (
            <div
              key={position.id}
              className={`p-4 hover:bg-dark-800/30 transition-colors ${
                isRisky ? "border-l-2 border-warning" : ""
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isLong ? "bg-profit/10" : "bg-loss/10"
                    }`}
                  >
                    {isLong ? (
                      <TrendingUp className="w-5 h-5 text-profit" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-loss" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${isLong ? "text-profit" : "text-loss"}`}
                      >
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                      <span className="px-2 py-0.5 text-xs rounded bg-dark-700 text-gray-300">
                        {leverage}x
                      </span>
                      {isRisky && (
                        <AlertTriangle className="w-4 h-4 text-warning" />
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      ALGO/USD Perpetual
                    </div>
                  </div>
                </div>

                <button
                  onClick={() =>
                    setSelectedPosition(
                      selectedPosition === position.id ? null : position.id,
                    )
                  }
                  className="p-1 rounded hover:bg-glass"
                >
                  <MoreVertical className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <p className="text-xs text-gray-400">Size</p>
                  <p className="font-mono">{size.toFixed(2)} ALGO</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Entry / Mark</p>
                  <p className="font-mono">${entryPrice.toFixed(4)}</p>
                  <p className="text-xs text-gray-500">
                    ${position.currentPrice.toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Liq. Price</p>
                  <p className="font-mono text-loss">
                    ${position.liquidationPrice.toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Unrealized P&L</p>
                  <p
                    className={`font-mono font-semibold ${isProfitable ? "text-profit" : "text-loss"}`}
                  >
                    {isProfitable ? "+" : ""}
                    {position.unrealizedPnL.toFixed(2)} ALGO
                  </p>
                  <p
                    className={`text-xs ${isProfitable ? "text-profit" : "text-loss"}`}
                  >
                    ({isProfitable ? "+" : ""}
                    {position.unrealizedPnLPercent.toFixed(2)}%)
                  </p>
                </div>
              </div>

              {/* Margin ratio bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Margin Ratio</span>
                  <span
                    className={`font-mono ${
                      position.marginRatio > 2000
                        ? "text-profit"
                        : position.marginRatio > 1000
                          ? "text-warning"
                          : "text-loss"
                    }`}
                  >
                    {(position.marginRatio / 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      position.marginRatio > 2000
                        ? "bg-profit"
                        : position.marginRatio > 1000
                          ? "bg-warning"
                          : "bg-loss"
                    }`}
                    style={{
                      width: `${Math.min(100, position.marginRatio / 50)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Expanded actions */}
              {selectedPosition === position.id && (
                <div className="pt-3 border-t border-glass-border space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1"
                      disabled
                    >
                      <Edit className="w-3 h-3" />
                      Add Margin
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1"
                      onClick={() =>
                        handleTakeProfit(position.id, position.unrealizedPnL)
                      }
                      disabled={
                        closingPositionId === position.id ||
                        takeProfitPositionId === position.id ||
                        tradingLoading ||
                        position.unrealizedPnL <= 0
                      }
                    >
                      {takeProfitPositionId === position.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Closing...
                        </>
                      ) : (
                        "Take Profit"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-loss border-loss/50 hover:bg-loss/10"
                      onClick={() => handleClosePosition(position.id)}
                      disabled={
                        closingPositionId === position.id ||
                        takeProfitPositionId === position.id ||
                        tradingLoading
                      }
                    >
                      {closingPositionId === position.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Closing...
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3" />
                          Close
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="p-4 bg-dark-800 border-t border-glass-border">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400">Total Margin</p>
            <p className="font-mono">200.00 ALGO</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Total Unrealized P&L</p>
            <p className="font-mono text-profit">+13.80 ALGO</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Net Funding</p>
            <p className="font-mono text-loss">-0.025 ALGO</p>
          </div>
        </div>
      </div>
    </div>
  );
}
