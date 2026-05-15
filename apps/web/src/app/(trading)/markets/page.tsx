'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';

interface AssetMarket {
  id: string;
  name: string;
  ticker: string;
  category: string;
  pricePerToken: string;
  totalSupply: string;
  status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Precious Metals',
  REAL_ESTATE: 'Real Estate',
  PRIVATE_DEBT: 'Private Debt',
  CORPORATE_BOND: 'Corporate Bond',
  COMMODITY: 'Commodity',
  PRIVATE_EQUITY: 'Private Equity',
};

export default function MarketsPage() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['markets'],
    queryFn: async () => {
      const { data } = await api.get('/assets?status=ACTIVE');
      return data as AssetMarket[];
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Markets</h1>
        <p className="text-sm text-gray-400 mt-1">Compliant real-world asset tokens on Algorand</p>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 py-20 text-center">Loading markets…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets?.map((asset) => (
            <Link
              key={asset.id}
              href={`/trade/${asset.id}`}
              className="bg-[#1A1D27] border border-[#2A2D3A] rounded-xl p-5 hover:border-blue-500/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                    {asset.name}
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">{asset.ticker}</span>
                </div>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                  {CATEGORY_LABELS[asset.category] ?? asset.category}
                </span>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-gray-500">Token Price</p>
                  <p className="text-lg font-bold text-white">
                    ${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Supply</p>
                  <p className="text-sm text-gray-300">
                    {(Number(asset.totalSupply) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && assets?.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <p>No active markets yet. Check back soon.</p>
        </div>
      )}
    </div>
  );
}
