'use client';

interface Level {
  price: string;
  quantity: string;
}

interface Props {
  bids: Level[];
  asks: Level[];
  lastTrade?: { price: string; side: 'BUY' | 'SELL' };
}

function formatPrice(p: string) {
  return (Number(p) / 1_000_000).toFixed(2);
}

function formatQty(q: string) {
  return (Number(q) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function maxQty(levels: Level[]): number {
  return Math.max(...levels.map((l) => Number(l.quantity)), 1);
}

export function OrderBook({ bids, asks, lastTrade }: Props) {
  const maxBid = maxQty(bids);
  const maxAsk = maxQty(asks);

  return (
    <div className="bg-[#1A1D27] rounded-xl border border-[#2A2D3A] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2A2D3A]">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Order Book</h3>
      </div>

      {/* Header */}
      <div className="grid grid-cols-2 px-4 py-2">
        <span className="text-xs text-gray-500">Price (USDC)</span>
        <span className="text-xs text-gray-500 text-right">Amount</span>
      </div>

      {/* Asks (sell side) — reversed so lowest ask is nearest to mid */}
      <div className="px-2 space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
        {[...asks].reverse().map((level, i) => (
          <div key={i} className="relative grid grid-cols-2 px-2 py-0.5 rounded text-xs">
            <div
              className="absolute inset-y-0 right-0 bg-red-500/10"
              style={{ width: `${(Number(level.quantity) / maxAsk) * 100}%` }}
            />
            <span className="relative text-red-400 font-mono">{formatPrice(level.price)}</span>
            <span className="relative text-gray-300 font-mono text-right">{formatQty(level.quantity)}</span>
          </div>
        ))}
      </div>

      {/* Spread / last trade */}
      {lastTrade && (
        <div className={`text-center py-2 text-sm font-bold ${lastTrade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
          {formatPrice(lastTrade.price)}
        </div>
      )}

      {/* Bids (buy side) */}
      <div className="px-2 space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
        {bids.map((level, i) => (
          <div key={i} className="relative grid grid-cols-2 px-2 py-0.5 rounded text-xs">
            <div
              className="absolute inset-y-0 right-0 bg-green-500/10"
              style={{ width: `${(Number(level.quantity) / maxBid) * 100}%` }}
            />
            <span className="relative text-green-400 font-mono">{formatPrice(level.price)}</span>
            <span className="relative text-gray-300 font-mono text-right">{formatQty(level.quantity)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
