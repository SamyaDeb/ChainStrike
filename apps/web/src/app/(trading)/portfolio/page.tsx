'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function PortfolioPage() {
  const { data: orders } = useQuery({
    queryKey: ['order-history'],
    queryFn: async () => {
      const { data } = await api.get('/orders/my');
      return data as Array<{
        id: string;
        side: string;
        orderType: string;
        price?: string;
        quantity: string;
        filledQuantity: string;
        status: string;
        createdAt: string;
      }>;
    },
  });

  const filled = orders?.filter((o) => ['FILLED', 'PARTIALLY_FILLED'].includes(o.status)) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-white">Portfolio</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open Orders', value: orders?.filter((o) => ['ACCEPTED', 'PARTIALLY_FILLED'].includes(o.status)).length ?? 0 },
          { label: 'Filled Orders', value: filled.length },
          { label: 'Total Trades', value: orders?.length ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="bg-[#1A1D27] border border-[#2A2D3A] rounded-xl p-5">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Order history */}
      <div className="bg-[#1A1D27] border border-[#2A2D3A] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2A2D3A]">
          <h2 className="text-sm font-semibold text-white">Order History</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2A2D3A]">
              {['Date', 'Side', 'Price', 'Quantity', 'Filled', 'Status'].map((h) => (
                <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2D3A]/50">
            {orders?.map((order) => (
              <tr key={order.id} className="hover:bg-white/[0.02]">
                <td className="px-6 py-3 text-gray-400 text-xs">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
                <td className={`px-6 py-3 font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {order.side}
                </td>
                <td className="px-6 py-3 font-mono text-gray-300">
                  {order.price ? `$${(Number(order.price) / 1_000_000).toFixed(4)}` : 'MKT'}
                </td>
                <td className="px-6 py-3 font-mono text-gray-300">
                  {(Number(order.quantity) / 1_000_000).toFixed(2)}
                </td>
                <td className="px-6 py-3 font-mono text-gray-300">
                  {(Number(order.filledQuantity) / 1_000_000).toFixed(2)}
                </td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    order.status === 'FILLED' ? 'bg-green-900/50 text-green-400' :
                    order.status === 'CANCELLED' ? 'bg-gray-800 text-gray-400' :
                    order.status === 'ACCEPTED' ? 'bg-blue-900/50 text-blue-400' :
                    'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {order.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!orders || orders.length === 0) && (
          <div className="py-16 text-center text-sm text-gray-500">
            No orders yet.{' '}
            <Link href="/markets" className="text-blue-400 hover:underline">Browse markets →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
