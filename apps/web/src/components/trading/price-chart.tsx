'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface OhlcvBar {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface Props {
  assetId: string;
  interval?: '1m' | '5m' | '15m' | '1h' | '1d';
}

const INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;

function toUsdc(microUsdc: string) {
  return Number(microUsdc) / 1_000_000;
}

export function PriceChart({ assetId, interval: initInterval = '1h' }: Props) {
  const [interval, setInterval] = useState(initInterval);

  const { data: bars } = useQuery({
    queryKey: ['ohlcv', assetId, interval],
    queryFn: async () => {
      const { data } = await api.get(`/orders/${assetId}/ohlcv?interval=${interval}&limit=60`);
      return (data as OhlcvBar[]).map((bar) => ({
        time: new Date(bar.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        open: toUsdc(bar.open),
        high: toUsdc(bar.high),
        low: toUsdc(bar.low),
        close: toUsdc(bar.close),
        volume: Number(bar.volume) / 1_000_000,
      }));
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="bg-[#1A1D27] rounded-xl border border-[#2A2D3A] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Price</h3>
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                interval === iv ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={bars ?? []} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2A2D3A" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            width={55}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{ background: '#1A1D27', border: '1px solid #2A2D3A', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9CA3AF' }}
            itemStyle={{ color: '#E5E7EB' }}
            formatter={(v: number) => [`$${v.toFixed(4)}`]}
          />
          <Bar dataKey="volume" fill="#3B82F620" />
          <Line dataKey="close" stroke="#3B82F6" dot={false} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
