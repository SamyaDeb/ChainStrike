'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@txnlab/use-wallet-react';
import { api } from '@/lib/api';
import Link from 'next/link';
import algosdk from 'algosdk';

const STAGE_LABELS: Record<number, string> = {
  1: 'Document Completeness',
  2: 'Custodian Verification',
  3: 'Legal Opinion Review',
  4: 'Risk Committee Sign-off',
  5: 'Final Compliance',
};

const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT   = Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
const ALGOD_TOKEN  = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '';

export default function IssueAssetDetailPage({ params }: { params: { id: string } }) {
  const { activeAddress, signTransactions, wallets } = useWallet();

  const [isOptedIn, setIsOptedIn] = useState<boolean | null>(null);
  const [optInLoading, setOptInLoading] = useState(false);
  const [optInError, setOptInError] = useState('');
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);

  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', params.id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${params.id}`);
      return data;
    },
  });

  useEffect(() => {
    if (!activeAddress || !asset?.asaId) { setIsOptedIn(null); setTokenBalance(null); return; }
    const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
    algod.accountAssetInformation(activeAddress, asset.asaId).do()
      .then((info: any) => {
        const holding = info.assetHolding ?? info['asset-holding'];
        setIsOptedIn(!!holding);
        if (holding) setTokenBalance(String(holding.amount ?? holding['amount'] ?? 0));
      })
      .catch(() => { setIsOptedIn(false); setTokenBalance(null); });
  }, [activeAddress, asset?.asaId]);

  async function handleOptIn() {
    if (!activeAddress || !signTransactions || !asset?.asaId) return;
    setOptInLoading(true);
    setOptInError('');
    try {
      const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        assetIndex: asset.asaId,
        amount: 0n,
        suggestedParams: sp,
      });
      const signedArr = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      const signed = signedArr[0];
      if (!signed) throw new Error('Wallet declined to sign');
      const { txid } = await algod.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algod, txid, 4);
      setIsOptedIn(true);
      setTokenBalance('0');
    } catch (e: any) {
      setOptInError(e?.message ?? 'Opt-in failed');
    } finally {
      setOptInLoading(false);
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!asset) return <div className="p-8 text-sm text-red-500">Asset not found</div>;

  const needsOptIn = (asset.status === 'PRE_MARKET' || asset.status === 'ACTIVE') && asset.asaId;
  const isActive = asset.status === 'ACTIVE';

  return (
    <div className="max-w-3xl space-y-8 p-8 mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/issue" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← My Issues</Link>
          <div className="flex items-center gap-3">
            {asset.logoUrl ? (
              <img src={asset.logoUrl} alt={asset.ticker} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '1px solid #ececec' }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 12, background: '#0c1116', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                {asset.ticker?.slice(0, 2)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{asset.name}</h1>
              <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{asset.ticker}</span>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-1 capitalize">{asset.category?.toLowerCase().replace(/_/g, ' ')}</p>
        </div>
      </div>

      {/* Key details */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Asset Details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          {[
            { label: 'Total Supply', value: `${(Number(asset.totalSupply) / 1_000_000).toLocaleString()} tokens` },
            { label: 'Price Per Token', value: `$${(Number(asset.pricePerToken ?? 0) / 1_000_000).toFixed(2)} USDC` },
            { label: 'Lockup Period', value: asset.lockupDays > 0 ? `${asset.lockupDays} days` : 'None' },
            { label: 'Min. KYC Tier', value: `Tier ${asset.minimumKycTier}` },
            { label: 'ASA ID', value: asset.asaId ? String(asset.asaId) : 'Not deployed' },
            { label: 'Status', value: asset.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
        {asset.description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500 leading-relaxed">{asset.description}</p>
          </div>
        )}
      </div>

      {/* Verification pipeline */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Verification Pipeline</h2>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((stage) => {
            const log = asset.verificationLogs?.find((l: { stage: number }) => l.stage === stage);
            return (
              <div key={stage} className="flex items-center gap-4">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  log?.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  log?.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {stage}
                </div>
                <span className="text-sm text-gray-700">{STAGE_LABELS[stage]}</span>
                {log && (
                  <span className={`ml-auto text-xs font-medium ${log.status === 'APPROVED' ? 'text-green-600' : 'text-red-600'}`}>
                    {log.status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {['SUBMITTED', 'UNDER_REVIEW'].includes(asset.status) && (
          <p className="mt-4 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Your asset is under admin review. Upload all required documents to speed up verification.
          </p>
        )}
      </div>

      {/* Liquidity Escrow */}
      {asset.issuanceEscrowStatus && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Liquidity Escrow</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                  asset.issuanceEscrowStatus === 'RELEASED_TO_VAULT' ? 'bg-green-100 text-green-700' :
                  asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'bg-red-100 text-red-600' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {asset.issuanceEscrowStatus === 'RELEASED_TO_VAULT' ? 'Released to Vault' :
                   asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'Returned to You' :
                   'Pending Admin Review'}
                </span>
              </dd>
            </div>
            {asset.issuanceEscrowAmount && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Amount Held</dt>
                <dd className="font-medium text-gray-900">
                  {(Number(asset.issuanceEscrowAmount) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                </dd>
              </div>
            )}
            {asset.issuanceEscrowTxId && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Deposit Tx</dt>
                <dd>
                  <a href={`https://testnet.explorer.perawallet.app/tx/${asset.issuanceEscrowTxId}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs font-mono text-blue-600 hover:underline">
                    {asset.issuanceEscrowTxId.slice(0, 12)}… ↗
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Opt-in to RWA ASA (PRE_MARKET / ACTIVE) */}
      {needsOptIn && (
        <div className="bg-white border border-blue-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Opt-in to Your Token on Algorand</h2>
          <p className="text-sm text-gray-500">
            ASA <strong>{String(asset.asaId)}</strong> — opt-in so your wallet can receive {asset.ticker} tokens.
          </p>

          {!activeAddress ? (
            <div className="flex gap-2 flex-wrap">
              {wallets?.map((wallet) => (
                <button key={wallet.id} onClick={() => wallet.connect()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                  Connect {wallet.metadata.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-gray-500">
                Wallet: <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">{activeAddress.slice(0, 8)}…{activeAddress.slice(-6)}</code>
              </div>
              {isOptedIn === null && <div className="text-xs text-gray-400 animate-pulse">Checking…</div>}
              {isOptedIn === true && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-green-700">Opted in ✓</p>
                  {tokenBalance !== null && (
                    <p className="text-xs text-green-600 mt-1">
                      Balance: <strong>{(Number(tokenBalance) / 1_000_000).toLocaleString()} {asset.ticker}</strong>
                    </p>
                  )}
                </div>
              )}
              {isOptedIn === false && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-sm text-amber-700">Not opted in to ASA <strong>{String(asset.asaId)}</strong>.</p>
                  <button onClick={handleOptIn} disabled={optInLoading}
                    className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-50">
                    {optInLoading ? 'Opting in…' : `Opt In to ${asset.ticker}`}
                  </button>
                  {optInError && <p className="text-xs text-red-600">{optInError}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LP Pool Position (ACTIVE only) */}
      {isActive && asset.lpAssetId && (
        <div className="bg-white border border-green-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <h2 className="text-sm font-semibold text-gray-900">Your Liquidity Pool Position</h2>
          </div>
          <p className="text-sm text-gray-600">
            Your LP tokens are custodied in the TokenVault contract until the lockup ends.
            Opt into the LP ASA from your wallet, then visit Tinyman to claim or manage your position.
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">LP Token ASA</dt>
              <dd className="font-mono font-medium text-gray-900">{String(asset.lpAssetId)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Your LP Amount</dt>
              <dd className="font-medium text-gray-900">{asset.issuerLpAmount ? Number(asset.issuerLpAmount).toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Lockup Ends</dt>
              <dd className="font-medium text-gray-900">
                {asset.lpLockupEndDate ? new Date(asset.lpLockupEndDate).toLocaleDateString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Pool</dt>
              <dd>
                <a href={`https://testnet.tinyman.org/#/pool/${asset.tinymanPoolAddress}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline">
                  View on Tinyman ↗
                </a>
              </dd>
            </div>
          </dl>
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
            <p className="text-xs text-amber-700 font-medium mb-1">To claim your LP tokens after lockup:</p>
            <ol className="text-xs text-amber-700 list-decimal ml-4 space-y-1">
              <li>Opt into LP ASA <strong>{String(asset.lpAssetId)}</strong> from your Algorand wallet</li>
              <li>Contact admin to transfer LP tokens from vault to your wallet</li>
              <li>Manage your position on <a href="https://testnet.tinyman.org" target="_blank" rel="noreferrer" className="underline">testnet.tinyman.org</a></li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
