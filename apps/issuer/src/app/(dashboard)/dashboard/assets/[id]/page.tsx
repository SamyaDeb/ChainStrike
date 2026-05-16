'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import algosdk from 'algosdk';
import { useWallet } from '@/providers/wallet-provider';

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

export default function AssetDetailPage({ params }: { params: { id: string } }) {
  const queryClient = useQueryClient();
  const { walletAddress, signer, connect } = useWallet();
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellError, setSellError] = useState('');
  const [sellSuccess, setSellSuccess] = useState('');
  const [manualWallet, setManualWallet] = useState('');

  // Opt-in state
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

  const { data: documents } = useQuery({
    queryKey: ['asset-documents', params.id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${params.id}/documents`);
      return data as Array<{ id: string; type: string; fileName: string; createdAt: string }>;
    },
    enabled: !!asset,
  });

  const effectiveWallet = walletAddress ?? manualWallet;

  // Check on-chain opt-in status whenever wallet or asaId changes
  useEffect(() => {
    if (!effectiveWallet || !asset?.asaId) { setIsOptedIn(null); setTokenBalance(null); return; }
    const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
    algod.accountAssetInformation(effectiveWallet, asset.asaId).do()
      .then((info: any) => {
        const holding = info.assetHolding ?? info['asset-holding'];
        setIsOptedIn(!!holding);
        if (holding) setTokenBalance(String(holding.amount ?? holding['amount'] ?? 0));
      })
      .catch(() => { setIsOptedIn(false); setTokenBalance(null); });
  }, [effectiveWallet, asset?.asaId]);

  async function handleOptIn() {
    if (!effectiveWallet) { setOptInError('Connect your Pera Wallet first'); return; }
    if (!asset?.asaId)    { setOptInError('ASA not yet deployed'); return; }
    if (!signer)          { setOptInError('Wallet signer not available — reconnect Pera'); return; }

    setOptInLoading(true);
    setOptInError('');
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
      const encoded = algosdk.encodeUnsignedTransaction(txn);
      const signed = await signer([encoded], [0]);
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

  async function placeSellOrder() {
    setSellError('');
    setSellSuccess('');
    if (!sellQty || !sellPrice) { setSellError('Enter quantity and price'); return; }
    try {
      const quantityBaseUnits = BigInt(Math.floor(parseFloat(sellQty) * 1_000_000)).toString();
      const priceBaseUnits = BigInt(Math.floor(parseFloat(sellPrice) * 1_000_000)).toString();
      await api.post('/orders', {
        side: 'SELL',
        assetId: params.id,
        walletAddress: effectiveWallet || 'ISSUER_WALLET',
        quantity: quantityBaseUnits,
        price: priceBaseUnits,
        orderType: 'LIMIT',
      });
      setSellSuccess(`Sell order placed: ${sellQty} ${asset?.ticker} @ $${sellPrice} USDC`);
      setSellQty('');
      setSellPrice('');
      queryClient.invalidateQueries({ queryKey: ['asset', params.id] });
    } catch (err: any) {
      setSellError(err?.response?.data?.message ?? 'Failed to place sell order');
    }
  }

  if (isLoading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!asset) return <div className="text-sm text-red-500">Asset not found</div>;

  const isPendingVerification = ['SUBMITTED', 'UNDER_REVIEW'].includes(asset.status) || asset.verificationStatus === 'PENDING';
  const isPreMarket = asset.status === 'PRE_MARKET';

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{asset.name}</h1>
            <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{asset.ticker}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1 capitalize">{asset.category.toLowerCase().replace(/_/g, ' ')}</p>
        </div>
        <Link href={`/dashboard/assets/${params.id}/documents`}
          className="px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">
          Upload Documents
        </Link>
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
            { label: 'Verification', value: asset.verificationStatus },
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
                  <span className={`ml-auto text-xs font-medium ${
                    log.status === 'APPROVED' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {log.status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {isPendingVerification && (
          <p className="mt-4 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Your asset is under admin review. Upload all required documents to speed up verification.
          </p>
        )}
      </div>

      {/* Liquidity Escrow status */}
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
                  <a href={`https://testnet.algoexplorer.io/tx/${asset.issuanceEscrowTxId}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs font-mono text-blue-600 hover:underline">
                    {asset.issuanceEscrowTxId.slice(0, 12)}… ↗
                  </a>
                </dd>
              </div>
            )}
            {asset.issuanceEscrowReleaseTxId && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">
                  {asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'Return Tx' : 'Release Tx'}
                </dt>
                <dd>
                  <a href={`https://testnet.algoexplorer.io/tx/${asset.issuanceEscrowReleaseTxId}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs font-mono text-blue-600 hover:underline">
                    {asset.issuanceEscrowReleaseTxId.slice(0, 12)}… ↗
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {asset.issuanceEscrowStatus === 'PENDING' && (
            <p className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Your USDC is held in the IssuanceLiquidityEscrow contract on Algorand testnet.
              It will be released to the token vault on approval, or returned to your wallet automatically if rejected.
            </p>
          )}
        </div>
      )}

      {/* PRE_MARKET / ACTIVE — Opt-in + Token Status */}
      {(isPreMarket || asset.status === 'ACTIVE') && asset.asaId && (
        <div className="space-y-4">
          {/* Step 1: Connect wallet + Opt-in */}
          <div className="bg-white border border-blue-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <h2 className="text-sm font-semibold text-gray-900">Opt-in to Your Token on Algorand</h2>
            </div>

            {/* Wallet connection */}
            {!walletAddress ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Connect your Pera Wallet to opt-in to ASA <strong>{asset.asaId}</strong> and receive tokens.
                </p>
                <button onClick={connect}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                  Connect Pera Wallet
                </button>
                <p className="text-xs text-gray-400">Or enter your wallet address manually to check status:</p>
                <input value={manualWallet} onChange={(e) => setManualWallet(e.target.value)}
                  placeholder="ALGORAND_WALLET_ADDRESS..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Connected: <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</code></span>
                </div>

                {/* Opt-in status */}
                {isOptedIn === null && (
                  <div className="text-xs text-gray-400 animate-pulse">Checking opt-in status…</div>
                )}
                {isOptedIn === true && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    <p className="text-sm font-semibold text-green-700">Opted in ✓</p>
                    {tokenBalance !== null && (
                      <p className="text-xs text-green-600 mt-1">
                        Balance: <strong>{(Number(tokenBalance) / 1_000_000).toLocaleString()} {asset.ticker}</strong>
                      </p>
                    )}
                    {tokenBalance === '0' && (
                      <p className="text-xs text-amber-600 mt-1">
                        You are opted in but have 0 tokens. Ask admin to click "Activate Market" to distribute your allocation.
                      </p>
                    )}
                  </div>
                )}
                {isOptedIn === false && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-3">
                    <p className="text-sm text-amber-700">
                      Not opted in to ASA <strong>{asset.asaId}</strong>. You must opt-in before you can receive tokens.
                    </p>
                    <p className="text-xs text-gray-500">Costs ~0.1 ALGO minimum balance.</p>
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

          {/* Step 2: Place Sell Orders */}
          {isPreMarket && (
          <div className="bg-white border border-blue-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <h2 className="text-sm font-semibold text-gray-900">List Your Token — Seed the Market</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              After receiving tokens, place SELL orders at your listing price. These sell orders ARE the initial liquidity — investors buy directly from you.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Your Pera Wallet Address</label>
                <input value={effectiveWallet} onChange={(e) => setManualWallet(e.target.value)}
                  placeholder="PERA_WALLET_ADDRESS..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Quantity (tokens)</label>
                  <input type="number" value={sellQty} onChange={(e) => setSellQty(e.target.value)}
                    placeholder="e.g. 500000"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Price (USDC per token)</label>
                  <input type="number" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)}
                    placeholder={`e.g. ${(Number(asset.pricePerToken ?? 0) / 1_000_000).toFixed(2)}`}
                    step="0.000001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {sellError && <p className="text-sm text-red-600">{sellError}</p>}
              {sellSuccess && <p className="text-sm text-green-600">{sellSuccess}</p>}
              <button onClick={placeSellOrder}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                Place Sell Order →
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Documents */}
      {documents && documents.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Uploaded Documents ({documents.length})</h2>
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.fileName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{doc.type} · {new Date(doc.createdAt).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={async () => {
                    const { data } = await api.get(`/assets/${params.id}/documents/${doc.id}/download`);
                    window.open(data.url, '_blank');
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
