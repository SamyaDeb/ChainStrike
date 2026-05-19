'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getPoolPrice } from '@/lib/tinyman';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const;
type Range = typeof RANGES[number];

interface Props {
  assetId: string;
  asaId?: number | null;
  listingPrice?: number;
  defaultRange?: Range;
}

/** Build a flat-baseline chart from a single current price so the chart never appears empty. */
function buildFallbackPoints(price: number, range: Range) {
  const now = Date.now();
  const msMap: Record<Range, number> = {
    '1D': 86_400_000,
    '1W': 7 * 86_400_000,
    '1M': 30 * 86_400_000,
    '3M': 90 * 86_400_000,
    '1Y': 365 * 86_400_000,
    'ALL': 365 * 86_400_000,
  };
  const span = msMap[range];
  const N = 40;
  return Array.from({ length: N }, (_, i) => {
    const ts = now - span + (i / (N - 1)) * span;
    return {
      price,
      time: new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    };
  });
}

export function PriceChart({ assetId, asaId, listingPrice = 1, defaultRange = '1W' }: Props) {
  const [range, setRange] = useState<Range>(defaultRange);

  const { data: points = [], isLoading } = useQuery({
    queryKey: ['price-history', assetId, range],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${assetId}/price-history?range=${range}`);
      return (data as Array<{ price: number; ts: string }>).map((p) => ({
        price: p.price,
        time: new Date(p.ts).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      }));
    },
    refetchInterval: 60_000,
  });

  // Live on-chain pool price to use as fallback baseline
  const { data: livePrice } = useQuery<number | null>({
    queryKey: ['poolPrice', asaId],
    queryFn: async () => getPoolPrice(asaId as number),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!asaId,
  });

  const basePrice = livePrice ?? listingPrice;

  // Use DB snapshots if available; otherwise show live/listing price as flat baseline
  const chartPoints = points.length > 0 ? points : buildFallbackPoints(basePrice, range);
  const isFallback = points.length === 0;

  const minPrice = Math.min(...chartPoints.map((p) => p.price)) * 0.995;
  const maxPrice = Math.max(...chartPoints.map((p) => p.price)) * 1.005;

  return (
    <div style={{ fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)' }}>
      {/* Range tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                fontSize: 12,
                fontWeight: range === r ? 700 : 500,
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: range === r ? '#0a0a0a' : 'transparent',
                color: range === r ? '#fff' : '#666',
                transition: 'all 0.15s',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {isFallback && !isLoading && (
          <span style={{
            fontSize: 11, color: '#999', fontStyle: 'italic',
          }}>
            {livePrice != null ? 'Live price · snapshots accumulating' : 'Listing price · awaiting pool data'}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartPoints} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0a0a0a" stopOpacity={isFallback ? 0.06 : 0.15} />
              <stop offset="95%" stopColor="#0a0a0a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: '#999' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fontSize: 11, fill: '#999' }}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v: number) => `$${v.toFixed(4)}`}
          />
          <Tooltip
            contentStyle={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              fontSize: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            formatter={(v: number) => [`$${v.toFixed(6)}`, 'Price']}
            labelStyle={{ color: '#666', marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={isFallback ? '#bbb' : '#0a0a0a'}
            strokeWidth={isFallback ? 1 : 1.5}
            strokeDasharray={isFallback ? '4 4' : undefined}
            fill="url(#priceGrad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
