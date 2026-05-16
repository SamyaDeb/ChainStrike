'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@txnlab/use-wallet-react';
import { OrderBook } from '@/components/trading/order-book';
import { OrderForm } from '@/components/trading/order-form';
import { PriceChart } from '@/components/trading/price-chart';
import { AssetOptIn } from '@/components/trading/asset-opt-in';
import { SettlementSigner } from '@/components/SettlementSigner';
import { useOrderBook } from '@/hooks/use-order-book';

export default function TradePage({ params }: { params: { assetId: string } }) {
  const { assetId } = params;
  const { activeAddress, activeWallet, transactionSigner } = useWallet();

  const { data: asset } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${assetId}`);
      return data;
    },
  });

  const { snapshot, connected } = useOrderBook(assetId);

  const { data: myOrders } = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => {
      const { data } = await api.get('/orders/my');
      return data as Array<{
        id: string;
        side: string;
        orderType: string;
        price?: string;
        quantity: string;
        remainingQuantity: string;
        status: string;
        createdAt: string;
      }>;
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Settlement signer (invisible) */}
      {activeAddress && activeWallet && (
        <SettlementSigner
          walletAddress={activeAddress}
          walletSigner={transactionSigner}
        />
      )}

      {/* Asset header */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">
            {asset?.name ?? '—'}
            <span className="ml-2 text-base font-mono text-gray-400">{asset?.ticker}</span>
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-500'}`} />
            <span className="text-xs text-gray-500">{connected ? 'Live' : 'Connecting…'}</span>
            {snapshot?.lastTrade && (
              <span className="text-sm font-semibold text-white ml-3">
                ${(Number(snapshot.lastTrade.price) / 1_000_000).toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main trading layout */}
      <div className="grid grid-cols-[1fr_280px_240px] gap-4">
        {/* Chart */}
        <div className="space-y-4">
          <PriceChart assetId={assetId} />

          {/* Open orders */}
          <div className="bg-[#1A1D27] rounded-xl border border-[#2A2D3A]">
            <div className="px-4 py-3 border-b border-[#2A2D3A]">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Open Orders</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#2A2D3A]">
                  {['Side', 'Type', 'Price', 'Qty', 'Remaining', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myOrders?.filter((o) => ['ACCEPTED', 'PARTIALLY_FILLED'].includes(o.status))
                  .map((order) => (
                    <tr key={order.id} className="border-b border-[#2A2D3A]/50 hover:bg-white/[0.02]">
                      <td className={`px-4 py-2 font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                        {order.side}
                      </td>
                      <td className="px-4 py-2 text-gray-300">{order.orderType}</td>
                      <td className="px-4 py-2 font-mono text-gray-300">
                        {order.price ? `$${(Number(order.price) / 1_000_000).toFixed(4)}` : 'MKT'}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-300">
                        {(Number(order.quantity) / 1_000_000).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-300">
                        {(Number(order.remainingQuantity) / 1_000_000).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-yellow-400">{order.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Order book */}
        <OrderBook
          bids={snapshot?.bids ?? []}
          asks={snapshot?.asks ?? []}
          lastTrade={snapshot?.lastTrade}
        />

        {/* Order form + opt-in */}
        <div className="space-y-4">
          {activeAddress && asset?.asaId && (
            <AssetOptIn asaId={asset.asaId} walletAddress={activeAddress} />
          )}
          <OrderForm
            assetId={assetId}
            asaId={asset?.asaId}
            referencePriceUsdc={asset?.referencePriceUsdc}
          />
        </div>
      </div>
    </div>
  );
}
