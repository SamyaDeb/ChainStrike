'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const;
type Range = typeof RANGES[number];

interface Props {
  assetId: string;
  defaultRange?: Range;
}

export function PriceChart({ assetId, defaultRange = '1W' }: Props) {
  const [range, setRange] = useState<Range>(defaultRange);

  const { data: points = [] } = useQuery({
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

  const minPrice = points.length ? Math.min(...points.map((p) => p.price)) * 0.995 : 0;
  const maxPrice = points.length ? Math.max(...points.map((p) => p.price)) * 1.005 : 1;

  return (
    <div style={{ fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)' }}>
      {/* Range tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
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

      {points.length === 0 ? (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 }}>
          No price data yet — snapshots recorded every 5 min after market opens.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0a0a0a" stopOpacity={0.15} />
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
              stroke="#0a0a0a"
              strokeWidth={1.5}
              fill="url(#priceGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
