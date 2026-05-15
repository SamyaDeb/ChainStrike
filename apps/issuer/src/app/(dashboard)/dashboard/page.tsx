'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SUBMITTED: 'bg-yellow-100 text-yellow-700',
  UNDER_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  PRE_MARKET: 'bg-purple-100 text-purple-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-600',
};

export default function DashboardPage() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['my-assets'],
    queryFn: async () => {
      const { data } = await api.get('/assets/my');
      return data as Array<{
        id: string;
        name: string;
        ticker: string;
        category: string;
        status: string;
        totalSupply: string;
        pricePerToken: string;
        createdAt: string;
      }>;
    },
  });

  const stats = {
    total: assets?.length ?? 0,
    active: assets?.filter((a) => a.status === 'ACTIVE').length ?? 0,
    pending: assets?.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length ?? 0,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Issuer Dashboard</h1>
        <Link
          href="/dashboard/assets/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Tokenize Asset
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Assets', value: stats.total },
          { label: 'Active Markets', value: stats.active },
          { label: 'Pending Review', value: stats.pending },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Asset list */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Your Assets</h2>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
        ) : assets?.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-gray-500">No assets yet.</p>
            <Link href="/dashboard/assets/new" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
              Tokenize your first asset →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Asset</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Supply</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assets?.map((asset) => (
                <tr key={asset.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/assets/${asset.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                      {asset.name}
                    </Link>
                    <span className="ml-2 text-xs text-gray-400">{asset.ticker}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 capitalize">{asset.category.toLowerCase().replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[asset.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {asset.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    {(Number(asset.totalSupply) / 1_000_000).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    ${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
