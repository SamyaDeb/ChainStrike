'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@/providers/wallet-provider';
import Link from 'next/link';
import algosdk from 'algosdk';

const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT   = Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
const ALGOD_TOKEN  = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '';

const STATUS_COLORS: Record<string, string> = {
  DRAFT:        'bg-gray-100 text-gray-600',
  SUBMITTED:    'bg-yellow-100 text-yellow-700',
  UNDER_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED:     'bg-green-100 text-green-700',
  PRE_MARKET:   'bg-purple-100 text-purple-700',
  ACTIVE:       'bg-emerald-100 text-emerald-700',
  SUSPENDED:    'bg-red-100 text-red-700',
  REJECTED:     'bg-red-100 text-red-600',
};

interface AssetRow {
  id: string;
  name: string;
  ticker: string;
  category: string;
  status: string;
  totalSupply: string;
  pricePerToken: string;
  liquidityDepositUsdc?: string;
  asaId?: number;
  issuerWalletAddress?: string;
  createdAt: string;
}

export default function DashboardPage() {
  const { walletAddress, signer, connect } = useWallet();

  const { data: assets, isLoading, refetch } = useQuery({
    queryKey: ['my-assets'],
    queryFn: async () => {
      const { data } = await api.get('/assets/my');
      return data as AssetRow[];
    },
    refetchOnMount: 'always',
  });

  // Per-asset opt-in state: assetId → 'loading' | 'opted-in' | 'not-opted-in'
  const [optInStatus, setOptInStatus] = useState<Record<string, 'loading' | 'opted-in' | 'not-opted-in'>>({});
  // Per-asset token balance (micro-units)
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  // Per-asset opt-in button loading
  const [optInLoading, setOptInLoading] = useState<Record<string, boolean>>({});
  const [optInError, setOptInError]  = useState<Record<string, string>>({});

  const effectiveWallet = walletAddress;

  // Check on-chain opt-in status for all PRE_MARKET / ACTIVE assets with an ASA
  const checkOptIns = useCallback(async (rows: AssetRow[], wallet: string | null) => {
    const relevant = rows.filter(
      (a) => a.asaId && (a.status === 'PRE_MARKET' || a.status === 'ACTIVE'),
    );
    if (!relevant.length) return;

    // Mark all as loading
    setOptInStatus((prev) => ({
      ...prev,
      ...Object.fromEntries(relevant.map((a) => [a.id, 'loading'])),
    }));

    await Promise.all(
      relevant.map(async (asset) => {
        const addr = wallet ?? asset.issuerWalletAddress;
        if (!addr || !asset.asaId) {
          setOptInStatus((prev) => ({ ...prev, [asset.id]: 'not-opted-in' }));
          return;
        }
        try {
          const r = await fetch(`${ALGOD_SERVER}/v2/accounts/${addr}/assets/${asset.asaId}`);
          const status = r.ok ? 'opted-in' : 'not-opted-in';
          if (r.ok) {
            const data = await r.json();
            const holding = data['asset-holding'] ?? data.assetHolding;
            const balance = holding?.amount ?? holding?.['amount'] ?? 0;
            setTokenBalances((prev) => ({ ...prev, [asset.id]: String(balance) }));
          }
          setOptInStatus((prev) => ({ ...prev, [asset.id]: status as any }));
        } catch {
          setOptInStatus((prev) => ({ ...prev, [asset.id]: 'not-opted-in' }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    if (assets) checkOptIns(assets, effectiveWallet);
  }, [assets, effectiveWallet, checkOptIns]);

  async function handleOptIn(asset: AssetRow) {
    if (!effectiveWallet || !signer) {
      try { await connect(); } catch {}
      return;
    }
    if (!asset.asaId) return;

    setOptInLoading((prev) => ({ ...prev, [asset.id]: true }));
    setOptInError((prev) => ({ ...prev, [asset.id]: '' }));

    try {
      const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: effectiveWallet,
        receiver: effectiveWallet,
        assetIndex: asset.asaId,
        amount: 0n,
        suggestedParams: sp,
      });
      const signed = await signer([algosdk.encodeUnsignedTransaction(txn)], [0]);
      const { txid } = await algod.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algod, txid, 4);
      setOptInStatus((prev) => ({ ...prev, [asset.id]: 'opted-in' }));
      setTokenBalances((prev) => ({ ...prev, [asset.id]: '0' }));
    } catch (e: any) {
      setOptInError((prev) => ({ ...prev, [asset.id]: e?.message ?? 'Opt-in failed' }));
    } finally {
      setOptInLoading((prev) => ({ ...prev, [asset.id]: false }));
    }
  }

  const stats = {
    total:   assets?.length ?? 0,
    active:  assets?.filter((a) => a.status === 'ACTIVE').length ?? 0,
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
          { label: 'Total Assets',    value: stats.total },
          { label: 'Active Markets',  value: stats.active },
          { label: 'Pending Review',  value: stats.pending },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Wallet bar — shows when wallet not connected but has PRE_MARKET / ACTIVE assets */}
      {!effectiveWallet && assets?.some((a) => a.asaId && ['PRE_MARKET', 'ACTIVE'].includes(a.status)) && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm text-amber-700 font-medium">
            Connect your Pera Wallet to opt-in and receive token distributions.
          </p>
          <button
            onClick={connect}
            className="px-4 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold"
          >
            Connect Pera Wallet
          </button>
        </div>
      )}
      {effectiveWallet && (
        <div className="flex items-center gap-2 text-xs text-gray-400 -mt-4">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
          Wallet connected: <code className="font-mono">{effectiveWallet.slice(0, 8)}…{effectiveWallet.slice(-6)}</code>
        </div>
      )}

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
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Supply / Your Tokens</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Price</th>
                <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase">Algorand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assets?.map((asset) => {
                const needsOptIn = asset.asaId && ['PRE_MARKET', 'ACTIVE'].includes(asset.status);
                const status     = optInStatus[asset.id];
                const balance    = tokenBalances[asset.id];
                const loading    = optInLoading[asset.id];
                const error      = optInError[asset.id];

                // Compute issuer's allocation from liquidity / price
                const allocationTokens = asset.liquidityDepositUsdc && asset.pricePerToken
                  ? Math.floor(Number(asset.liquidityDepositUsdc) / Number(asset.pricePerToken))
                  : null;

                return (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    {/* Asset name */}
                    <td className="px-6 py-4">
                      <Link href={`/dashboard/assets/${asset.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {asset.name}
                      </Link>
                      <span className="ml-2 text-xs text-gray-400">{asset.ticker}</span>
                      {asset.asaId && (
                        <div className="text-xs text-gray-400 mt-0.5">ASA {asset.asaId}</div>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-6 py-4 text-gray-500 capitalize">
                      {asset.category.toLowerCase().replace('_', ' ')}
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[asset.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {asset.status.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Supply + token balance */}
                    <td className="px-6 py-4 text-right">
                      <div className="text-gray-600">
                        {(Number(asset.totalSupply) / 1_000_000).toLocaleString()}
                      </div>
                      {needsOptIn && status === 'opted-in' && balance !== undefined && (
                        <div className="text-xs text-emerald-600 font-semibold mt-0.5">
                          You hold: {(Number(balance) / 1_000_000).toLocaleString()} {asset.ticker}
                          {Number(balance) === 0 && allocationTokens !== null && (
                            <span className="text-amber-500 font-normal"> (awaiting {allocationTokens.toLocaleString()} — ask admin to activate)</span>
                          )}
                        </div>
                      )}
                      {needsOptIn && status === 'not-opted-in' && allocationTokens !== null && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          Allocation: ~{allocationTokens.toLocaleString()} {asset.ticker}
                        </div>
                      )}
                    </td>

                    {/* Price */}
                    <td className="px-6 py-4 text-right text-gray-600">
                      ${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)}
                    </td>

                    {/* Algorand opt-in column */}
                    <td className="px-6 py-4 text-center">
                      {!needsOptIn ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : status === 'loading' ? (
                        <span className="text-xs text-gray-400 animate-pulse">Checking…</span>
                      ) : status === 'opted-in' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Opted In
                        </span>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          {effectiveWallet ? (
                            <button
                              onClick={() => handleOptIn(asset)}
                              disabled={loading}
                              className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-full px-3 py-1.5 disabled:opacity-50 transition-colors"
                            >
                              {loading ? 'Opting in…' : `Opt In to ${asset.ticker}`}
                            </button>
                          ) : (
                            <button
                              onClick={connect}
                              className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-full px-3 py-1.5 transition-colors"
                            >
                              Connect Wallet
                            </button>
                          )}
                          {error && <p className="text-xs text-red-500 max-w-[140px] text-center">{error}</p>}
                          <p className="text-xs text-gray-400">Required to receive tokens</p>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
