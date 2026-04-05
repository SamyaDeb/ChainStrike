"use client";

import { OptionPosition, OptionStatus, OptionType } from "@/types/option";
import { TrendingUp, TrendingDown, MoreVertical, DollarSign, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback } from "react";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { getOptionPositions } from "@/services/contracts";
import { useOptionsTrading } from "@/hooks/useTrading";
import { CountdownTimer } from "@/components/trading/countdown-timer";

// Extended position type with computed fields
interface PositionWithPnL extends OptionPosition {
  currentPrice: number;
  pnl: number;
  // On-chain option data
  optionId?: number;
  txId?: string;
  isSettled?: boolean;
  settlementPrice?: number;
  isCall?: boolean;
  strike?: number;
  expiry?: number;
  size?: number;
  premium?: number;
}

interface PositionsPanelProps {
  positions?: PositionWithPnL[];
}

// Determine if option is expired based on expiry timestamp
function isExpired(expiryTimestamp: number): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiryTimestamp <= nowSeconds;
}

// Calculate payout for a settled/expired option
function calculatePayout(
  isCall: boolean,
  strikePrice: number, // in USD
  settlementPrice: number, // in USD
  size: number // in ALGO
): number {
  if (isCall) {
    // Call: max(0, settlement - strike) * size / settlement
    if (settlementPrice > strikePrice) {
      return ((settlementPrice - strikePrice) * size) / settlementPrice;
    }
    return 0;
  } else {
    // Put: max(0, strike - settlement) * size / settlement
    if (strikePrice > settlementPrice) {
      return ((strikePrice - settlementPrice) * size) / settlementPrice;
    }
    return 0;
  }
}

// Determine if option is in the money
function isInTheMoney(isCall: boolean, strikePrice: number, currentPrice: number): boolean {
  if (isCall) {
    return currentPrice > strikePrice;
  }
  return currentPrice < strikePrice;
}

export function PositionsPanel({ positions: propPositions }: PositionsPanelProps) {
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [positions, setPositions] = useState<PositionWithPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const { activeAccount } = useSafeWallet();
  const activeAddress = activeAccount?.address;
  const { settleOption, isLoading: tradingLoading } = useOptionsTrading();

  // Format contract positions to component format
  const formatPositions = useCallback((contractPositions: Awaited<ReturnType<typeof getOptionPositions>>, address: string): PositionWithPnL[] => {
    return contractPositions.map((p, index) => {
      // Get expiry in seconds (contract stores in seconds)
      const expirySeconds = p.expiry || (p.expiryDate ? Math.floor(p.expiryDate.getTime() / 1000) : Math.floor(Date.now() / 1000) + 86400 * 7);
      const expiryMs = expirySeconds * 1000;
      
      return {
        id: p.optionId || index + 1,
        owner: address,
        seriesId: index + 1,
        quantity: BigInt(Math.floor(p.size || p.quantity || 1)),
        premiumPaid: BigInt(Math.floor((p.premium || p.entryPrice * p.size) * 1000000)),
        purchasePrice: BigInt(Math.floor(p.entryPrice * 1000000)),
        purchasedAt: p.timestamp || Date.now() - 86400000,
        status: p.isSettled ? OptionStatus.SETTLED : (isExpired(expirySeconds) ? OptionStatus.EXPIRED : OptionStatus.ACTIVE),
        optionType: p.optionType === 'call' ? OptionType.CALL : OptionType.PUT,
        strikePrice: BigInt(Math.floor((p.strike || 0) * 1000000)),
        expiryTimestamp: expiryMs,
        currentPrice: p.currentPrice,
        pnl: p.pnl,
        // On-chain fields
        optionId: p.optionId,
        txId: p.txId,
        isSettled: p.isSettled,
        settlementPrice: p.settlementPrice,
        isCall: p.optionType === 'call',
        strike: p.strike,
        expiry: expirySeconds,
        size: p.size || p.quantity || 1,
        premium: p.premium || p.entryPrice * (p.size || p.quantity || 1),
      };
    });
  }, []);

  // Handle settlement claim
  const handleClaimSettlement = useCallback(async (position: PositionWithPnL) => {
    if (!position.optionId) {
      console.error('No option ID for settlement', {
        positionId: position.id,
        txId: position.txId,
        strike: position.strike,
        expiry: position.expiry,
      });
      // Show user-friendly error
      alert('Unable to settle: Option ID not found. This may be because the transaction is still being indexed. Please try refreshing the page in a few moments.');
      return;
    }

    setSettlingId(position.optionId);
    try {
      const result = await settleOption(position.optionId);
      if (result.success) {
        console.log('Settlement successful!', {
          txId: result.txId,
          payout: result.settlementPayout,
        });
        
        // Refresh positions after successful settlement
        if (activeAddress) {
          const contractPositions = await getOptionPositions(activeAddress);
          const formattedPositions = formatPositions(contractPositions, activeAddress);
          setPositions(formattedPositions);
        }
      } else {
        console.error('Settlement failed:', result.error);
        alert(`Settlement failed: ${result.error}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Settlement error:', errorMessage, err);
      alert(`Settlement error: ${errorMessage}`);
    } finally {
      setSettlingId(null);
    }
  }, [settleOption, activeAddress, formatPositions]);

  // Fetch real positions from contract
  useEffect(() => {
    async function fetchPositions() {
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
        const contractPositions = await getOptionPositions(activeAddress);
        const formattedPositions = formatPositions(contractPositions, activeAddress);
        
        // Log positions summary for debugging
        console.log(`[PositionsPanel] Loaded ${formattedPositions.length} positions`, {
          withOptionId: formattedPositions.filter(p => p.optionId).length,
          withoutOptionId: formattedPositions.filter(p => !p.optionId).length,
        });
        
        setPositions(formattedPositions);
      } catch (error) {
        console.error('Error fetching option positions:', error);
        setPositions([]);
      } finally {
        setLoading(false);
      }
    }

    fetchPositions();
    
    // Auto-refresh every 10 seconds for better countdown updates
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [activeAddress, propPositions, formatPositions]);

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
          Your option positions will appear here once you make a trade.
        </p>
      </div>
    );
  }
  
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-glass-border">
        <h3 className="font-semibold">Positions</h3>
      </div>
      
      <div className="divide-y divide-glass-border">
        {positions.map((position) => {
          const isCall = position.optionType === OptionType.CALL;
          const strike = Number(position.strikePrice) / 1000000;
          const expirySeconds = position.expiry || Math.floor((position.expiryTimestamp || 0) / 1000);
          const expired = isExpired(expirySeconds);
          const settled = position.isSettled || position.status === OptionStatus.SETTLED;
          
          // Calculate ITM status and potential payout
          const itm = isInTheMoney(isCall, strike, position.currentPrice);
          const potentialPayout = expired && !settled && itm
            ? calculatePayout(isCall, strike, position.currentPrice, position.size || Number(position.quantity))
            : 0;
          const premiumPaidAlgo = Number(position.premiumPaid) / 1000000;
          const netPnL = settled 
            ? (position.settlementPrice ? calculatePayout(isCall, strike, position.settlementPrice, position.size || Number(position.quantity)) - premiumPaidAlgo : position.pnl)
            : (expired 
              ? (itm ? potentialPayout - premiumPaidAlgo : -premiumPaidAlgo)
              : position.pnl);
          const isProfitable = netPnL >= 0;

          // Determine status badge
          let statusBadge: React.ReactNode = null;
          if (settled) {
            statusBadge = (
              <Badge variant="default" className="bg-gray-500/10 text-gray-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Settled
              </Badge>
            );
          } else if (expired) {
            if (itm) {
              statusBadge = (
                <Badge variant="success" className="animate-pulse">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  ITM - Claim!
                </Badge>
              );
            } else {
              statusBadge = (
                <Badge variant="danger">
                  <XCircle className="w-3 h-3 mr-1" />
                  Expired OTM
                </Badge>
              );
            }
          } else {
            statusBadge = (
              <Badge variant="info">
                Active
              </Badge>
            );
          }
          
          // Determine card styling based on profit/loss status
          let cardClassName = "p-4 transition-colors ";
          if (settled) {
            // Settled positions - gray styling
            cardClassName += "bg-gray-900/30 border-l-4 border-gray-500/50";
          } else if (expired) {
            if (itm) {
              // Expired ITM (profitable) - green styling with highlight
              cardClassName += "bg-profit/5 border-l-4 border-profit ring-1 ring-profit/30 hover:bg-profit/10";
            } else {
              // Expired OTM (loss) - red styling
              cardClassName += "bg-loss/5 border-l-4 border-loss hover:bg-loss/10";
            }
          } else {
            // Active positions - neutral styling
            cardClassName += "hover:bg-dark-800/30";
          }
          
          return (
            <div 
              key={position.id} 
              className={cardClassName}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isCall ? "bg-profit/10" : "bg-loss/10"
                  }`}>
                    {isCall ? (
                      <TrendingUp className="w-5 h-5 text-profit" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-loss" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isCall ? "text-profit" : "text-loss"}`}>
                        {isCall ? "CALL" : "PUT"}
                      </span>
                      <span className="text-white font-mono">${strike.toFixed(4)}</span>
                      {statusBadge}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                      <span>{Number(position.quantity).toString()} contract{Number(position.quantity) > 1 ? 's' : ''}</span>
                      <span className="text-gray-500">•</span>
                      <CountdownTimer expiryTimestamp={expirySeconds} />
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={() => setSelectedPosition(selectedPosition === position.id ? null : position.id)}
                  className="p-1 rounded hover:bg-glass"
                >
                  <MoreVertical className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Premium Paid</p>
                  <p className="font-mono">{premiumPaidAlgo.toFixed(4)} ALGO</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">{settled ? 'Settlement Price' : 'Current Price'}</p>
                  <p className="font-mono">${(settled && position.settlementPrice ? position.settlementPrice : position.currentPrice).toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">P&L</p>
                  <p className={`font-mono font-semibold ${isProfitable ? "text-profit" : "text-loss"}`}>
                    {isProfitable ? "+" : ""}{netPnL.toFixed(4)} ALGO
                  </p>
                </div>
              </div>
              
              {/* Show claim button for expired ITM options */}
              {expired && itm && !settled && (
                <div className="mt-4 pt-4 border-t border-glass-border">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm text-profit font-medium">Option expired in the money!</p>
                      <p className="text-xs text-gray-400">
                        Payout: <span className="text-profit font-mono">{potentialPayout.toFixed(4)} ALGO</span>
                      </p>
                    </div>
                    <Button 
                      size="sm" 
                      className="bg-profit hover:bg-profit/80 text-dark-900"
                      onClick={() => handleClaimSettlement(position)}
                      disabled={settlingId === position.optionId || tradingLoading}
                    >
                      {settlingId === position.optionId ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Settling...
                        </>
                      ) : (
                        'Claim Settlement'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Show expired OTM info - no claim button, just loss message */}
              {expired && !itm && !settled && (
                <div className="mt-4 pt-4 border-t border-loss/20">
                  <div className="flex items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4 text-loss" />
                    <span className="text-loss">
                      Option expired out of the money - Loss: {Math.abs(premiumPaidAlgo).toFixed(4)} ALGO
                    </span>
                  </div>
                </div>
              )}

              {/* Show settled info */}
              {settled && (
                <div className="mt-4 pt-4 border-t border-glass-border">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className={`w-4 h-4 ${isProfitable ? 'text-profit' : 'text-gray-400'}`} />
                    <span className="text-gray-400">
                      {isProfitable 
                        ? `Settlement complete - ${Math.abs(netPnL).toFixed(4)} ALGO received`
                        : 'Option expired out of the money - no payout'
                      }
                    </span>
                  </div>
                </div>
              )}
              
              {/* Expanded actions for active positions */}
              {!expired && !settled && selectedPosition === position.id && (
                <div className="mt-4 pt-4 border-t border-glass-border flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" disabled>
                    Exercise Early
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" disabled>
                    Close Position
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
