'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getAdminToken, adminLogout } from '@/lib/auth';

const STAGE_LABELS: Record<number, string> = {
  1: 'Document Completeness',
  2: 'Custodian Verification',
  3: 'Legal Opinion Review',
  4: 'Risk Committee Sign-off',
  5: 'Final Compliance',
};

interface VerificationLog { stage: number; status: string; notes?: string; reviewerId?: string; createdAt: string; }

interface Asset {
  id: string; name: string; ticker: string; category: string;
  status: string; verificationStatus: string; issuerId: string;
  asaId?: number; totalSupply?: string; pricePerToken?: string; createdAt: string;
  verificationLogs?: VerificationLog[];
  issuerWalletAddress?: string;
  issuanceEscrowStatus?: 'PENDING' | 'RELEASED_TO_VAULT' | 'RETURNED_TO_ISSUER';
  issuanceEscrowAmount?: string;
  issuanceEscrowTxId?: string;
  issuanceEscrowReleaseTxId?: string;
}

interface AmlAlert {
  id: string; alertType: string; severity: string; walletAddress: string;
  description: string; status: string; createdAt: string;
}

const ALGOD = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';

async function checkIssuerOptedIn(issuerAddress: string, asaId: number): Promise<boolean> {
  try {
    const r = await fetch(`${ALGOD}/v2/accounts/${issuerAddress}/assets/${asaId}`);
    if (!r.ok) return false;
    const data = await r.json();
    return !!(data['asset-holding'] ?? data.assetHolding);
  } catch { return false; }
}

export default function AdminDashboard() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [alerts, setAlerts] = useState<AmlAlert[]>([]);
  const [tab, setTab] = useState<'assets' | 'aml' | 'users'>('assets');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [issuerOptIn, setIssuerOptIn] = useState<Record<string, boolean>>({});

  // Review modal state
  const [reviewAsset, setReviewAsset] = useState<Asset | null>(null);
  const [stageDecisions, setStageDecisions] = useState<Record<number, { status: 'APPROVED' | 'REJECTED'; notes: string }>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewResult, setReviewResult] = useState<{ returnTxId?: string; stage?: number } | null>(null);

  // Rejection confirmation modal
  const [rejectConfirm, setRejectConfirm] = useState<{ assetId: string; assetName: string; stage: number; issuerWallet: string; amountUsdc: string } | null>(null);

  // Distribute tokens modal state
  const [distributeAsset, setDistributeAsset] = useState<Asset | null>(null);
  const [issuerWallet, setIssuerWallet] = useState('');
  const [distributeAmount, setDistributeAmount] = useState('');
  const [distributeLoading, setDistributeLoading] = useState(false);
  const [distributeError, setDistributeError] = useState('');
  const [distributeTxid, setDistributeTxid] = useState('');

  useEffect(() => {
    if (!getAdminToken()) { router.push('/login'); return; }
    loadData();
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [assetsRes, alertsRes] = await Promise.all([
        api.get('/assets?status=SUBMITTED,UNDER_REVIEW,APPROVED,PRE_MARKET,ACTIVE').catch(() => ({ data: [] })),
        api.get('/compliance/aml/alerts').catch(() => ({ data: [] })),
      ]);
      const loadedAssets: Asset[] = assetsRes.data ?? [];
      setAssets(loadedAssets);
      setAlerts(alertsRes.data ?? []);

      // Check issuer opt-in for PRE_MARKET assets
      const preMarket = loadedAssets.filter((a) => a.status === 'PRE_MARKET' && a.asaId && a.issuerWalletAddress);
      const optInResults = await Promise.all(
        preMarket.map(async (a) => ({
          id: a.id,
          optedIn: await checkIssuerOptedIn(a.issuerWalletAddress!, a.asaId!),
        }))
      );
      setIssuerOptIn(Object.fromEntries(optInResults.map(({ id, optedIn }) => [id, optedIn])));
    } finally {
      setLoading(false);
    }
  }

  function openReview(asset: Asset) {
    const initial: Record<number, { status: 'APPROVED' | 'REJECTED'; notes: string }> = {};
    for (let s = 1; s <= 5; s++) {
      const existing = asset.verificationLogs?.find((l) => l.stage === s);
      initial[s] = { status: (existing?.status as any) ?? 'APPROVED', notes: existing?.notes ?? '' };
    }
    setStageDecisions(initial);
    setReviewError('');
    setReviewResult(null);
    setReviewAsset(asset);
  }

  async function submitReview() {
    if (!reviewAsset) return;

    // Detect first rejection in new stages being submitted
    for (let stage = 1; stage <= 5; stage++) {
      const existing = reviewAsset.verificationLogs?.find((l) => l.stage === stage);
      if (!existing && stageDecisions[stage]?.status === 'REJECTED') {
        const escrowPending = reviewAsset.issuanceEscrowStatus === 'PENDING';
        const amountUsdc = reviewAsset.issuanceEscrowAmount
          ? (Number(reviewAsset.issuanceEscrowAmount) / 1_000_000).toLocaleString()
          : '0';
        if (escrowPending && reviewAsset.issuerWalletAddress) {
          setRejectConfirm({
            assetId: reviewAsset.id,
            assetName: reviewAsset.name,
            stage,
            issuerWallet: reviewAsset.issuerWalletAddress,
            amountUsdc,
          });
          return;
        }
        break;
      }
    }
    await doSubmitReview();
  }

  async function doSubmitReview() {
    if (!reviewAsset) return;
    setReviewSubmitting(true);
    setReviewError('');
    setReviewResult(null);
    try {
      for (let stage = 1; stage <= 5; stage++) {
        const existing = reviewAsset.verificationLogs?.find((l) => l.stage === stage);
        if (!existing) {
          const res = await api.post(`/assets/${reviewAsset.id}/verification-stage`, {
            stage,
            status: stageDecisions[stage].status,
            notes: stageDecisions[stage].notes || undefined,
          });
          // If this stage caused a rejection + escrow return, capture the txId
          if (stageDecisions[stage].status === 'REJECTED' && res.data?.issuanceEscrowReleaseTxId) {
            setReviewResult({ returnTxId: res.data.issuanceEscrowReleaseTxId, stage });
          }
        }
      }
      await loadData();
    } catch (err: any) {
      setReviewError(err?.response?.data?.message ?? 'Failed to submit review');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function deployAsa(assetId: string) {
    setActionLoading(assetId + ':deploy');
    try {
      // On-chain deploy does 4+ txns (mint ASA, vault deploy, unfreeze, token transfer)
      // — can take 90-120 s on testnet. Override the default 15 s axios timeout.
      await api.patch(`/assets/${assetId}/deploy-asa`, undefined, { timeout: 180_000 });
      await loadData();
    } catch (err: any) {
      if (err.code === 'ECONNABORTED') {
        alert('Deploy is taking longer than expected. Refresh in 30 seconds — it likely succeeded on-chain.');
      } else {
        alert(err?.response?.data?.message ?? 'Deploy failed');
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function activateMarket(assetId: string) {
    setActionLoading(assetId + ':activate');
    try {
      // Activate does 3+ on-chain txns (USDC opt-in, escrow release, token distribute)
      // — can take 60-90 s on testnet.
      await api.patch(`/assets/${assetId}/activate`, undefined, { timeout: 180_000 });
      await loadData();
    } catch (err: any) {
      if (err.code === 'ECONNABORTED') {
        alert('Activate is taking longer than expected. Refresh in 30 seconds — it likely succeeded on-chain.');
      } else {
        alert(err?.response?.data?.message ?? 'Activate market failed');
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function submitDistribute() {
    if (!distributeAsset || !issuerWallet || !distributeAmount) return;
    setDistributeLoading(true);
    setDistributeError('');
    setDistributeTxid('');
    try {
      const amountBaseUnits = BigInt(Math.floor(parseFloat(distributeAmount) * 1_000_000)).toString();
      const { data } = await api.post(`/assets/${distributeAsset.id}/distribute-tokens`, {
        issuerWalletAddress: issuerWallet,
        amount: amountBaseUnits,
      });
      setDistributeTxid(data.txid);
      await loadData();
    } catch (err: any) {
      setDistributeError(err?.response?.data?.message ?? 'Distribution failed');
    } finally {
      setDistributeLoading(false);
    }
  }

  const pendingAssets = assets.filter((a) => ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].includes(a.verificationStatus));
  const approvedAssets = assets.filter((a) => a.verificationStatus === 'APPROVED' && !a.asaId);
  const preMarketAssets = assets.filter((a) => a.status === 'PRE_MARKET');
  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <div>
          <span className="font-bold text-gray-900">ChainStrike</span>
          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">Admin</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {openAlerts.length > 0 && (
            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium">
              {openAlerts.length} AML alerts
            </span>
          )}
          <button onClick={adminLogout} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100">
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Pending Review', value: pendingAssets.length, color: 'text-yellow-600' },
            { label: 'Ready to Deploy', value: approvedAssets.length, color: 'text-blue-600' },
            { label: 'Pre-Market', value: preMarketAssets.length, color: 'text-purple-600' },
            { label: 'AML Alerts (Open)', value: openAlerts.length, color: 'text-red-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(['assets', 'aml', 'users'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'aml' ? 'AML Alerts' : t === 'assets' ? 'Asset Pipeline' : 'Users'}
            </button>
          ))}
        </div>

        {tab === 'assets' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Asset', 'Category', 'Verification', 'Escrow', 'Status', 'ASA ID', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : assets.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No assets yet</td></tr>
                ) : assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{asset.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{asset.ticker}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 capitalize">{asset.category.toLowerCase().replace('_', ' ')}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          asset.verificationStatus === 'APPROVED' ? 'bg-green-100 text-green-700' :
                          asset.verificationStatus === 'REJECTED' ? 'bg-red-100 text-red-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>{asset.verificationStatus}</span>
                        {asset.verificationLogs && asset.verificationLogs.length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            {asset.verificationLogs.filter((l) => l.status === 'APPROVED').length}/5 stages
                          </p>
                        )}
                      </div>
                    </td>
                    {/* Issuance escrow status column */}
                    <td className="px-6 py-4">
                      {asset.issuanceEscrowStatus ? (
                        <div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            asset.issuanceEscrowStatus === 'RELEASED_TO_VAULT' ? 'bg-green-100 text-green-700' :
                            asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'bg-red-100 text-red-600' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {asset.issuanceEscrowStatus === 'RELEASED_TO_VAULT' ? 'Released' :
                             asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'Returned' : 'Pending'}
                          </span>
                          {asset.issuanceEscrowAmount && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {(Number(asset.issuanceEscrowAmount) / 1_000_000).toLocaleString()} USDC
                            </p>
                          )}
                          {asset.issuanceEscrowReleaseTxId && (
                            <a href={`https://testnet.algoexplorer.io/tx/${asset.issuanceEscrowReleaseTxId}`}
                              target="_blank" rel="noreferrer"
                              className="text-xs text-blue-500 hover:underline">tx ↗</a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        asset.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                        asset.status === 'PRE_MARKET' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{asset.status}</span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-500">{asset.asaId ?? '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {asset.verificationStatus !== 'APPROVED' && (
                          <button onClick={() => openReview(asset)}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                            Review
                          </button>
                        )}
                        {asset.verificationStatus === 'APPROVED' && !asset.asaId && (
                          <button onClick={() => deployAsa(asset.id)}
                            disabled={actionLoading === asset.id + ':deploy'}
                            className="text-xs px-2.5 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                            {actionLoading === asset.id + ':deploy' ? 'Deploying…' : 'Deploy ASA'}
                          </button>
                        )}
                        {asset.status === 'PRE_MARKET' && (
                          <div className="flex flex-col items-end gap-1">
                            {asset.asaId && asset.issuerWalletAddress && issuerOptIn[asset.id] === false && (
                              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                ⚠ Issuer not opted in
                              </span>
                            )}
                            {asset.asaId && asset.issuerWalletAddress && issuerOptIn[asset.id] === true && (
                              <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                                ✓ Issuer opted in
                              </span>
                            )}
                            <button
                              onClick={() => activateMarket(asset.id)}
                              disabled={actionLoading === asset.id + ':activate' || issuerOptIn[asset.id] === false}
                              title={issuerOptIn[asset.id] === false ? 'Issuer must opt-in to their ASA via the Issuer Dashboard first' : ''}
                              className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                              {actionLoading === asset.id + ':activate' ? 'Activating…' : 'Activate Market'}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'aml' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Type', 'Severity', 'Wallet', 'Description', 'Status', 'Date'].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {alerts.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No alerts</td></tr>
                ) : alerts.map((alert) => (
                  <tr key={alert.id} className={alert.severity === 'CRITICAL' ? 'bg-red-50' : ''}>
                    <td className="px-6 py-3 text-xs font-medium">{alert.alertType.replace('_', ' ')}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        alert.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                        alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{alert.severity}</span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-600">
                      {alert.walletAddress.slice(0, 8)}…{alert.walletAddress.slice(-6)}
                    </td>
                    <td className="px-6 py-3 text-gray-600 text-xs max-w-xs truncate">{alert.description}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        alert.status === 'OPEN' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                      }`}>{alert.status}</span>
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-400">{new Date(alert.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'users' && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            User management — connect to identity service to view KYC status, roles, and account actions.
          </div>
        )}
      </div>

      {/* ── 5-Stage Review Modal ──────────────────────────────────────────── */}
      {reviewAsset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                Review: {reviewAsset.name} ({reviewAsset.ticker})
              </h2>
              <p className="text-sm text-gray-500 mt-1">Submit decisions for each verification stage.</p>
            </div>

            {/* Escrow info banner */}
            {reviewAsset.issuanceEscrowStatus === 'PENDING' && reviewAsset.issuanceEscrowAmount && (
              <div className="mx-6 mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                <span className="font-semibold">On-chain escrow:</span>{' '}
                {(Number(reviewAsset.issuanceEscrowAmount) / 1_000_000).toLocaleString()} USDC held in escrow.
                Approving Stage 5 releases it to vault on Deploy ASA. Any rejection returns it to issuer immediately.
              </div>
            )}

            {/* Rejection on-chain result */}
            {reviewResult?.returnTxId && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                <p className="font-semibold">USDC returned to issuer on-chain</p>
                <p className="font-mono break-all mt-1">{reviewResult.returnTxId}</p>
                <a href={`https://testnet.algoexplorer.io/tx/${reviewResult.returnTxId}`}
                  target="_blank" rel="noreferrer"
                  className="text-blue-600 hover:underline mt-1 block">View on AlgoExplorer ↗</a>
              </div>
            )}

            <div className="p-6 space-y-5">
              {[1, 2, 3, 4, 5].map((stage) => {
                const existing = reviewAsset.verificationLogs?.find((l) => l.stage === stage);
                const decision = stageDecisions[stage] ?? { status: 'APPROVED', notes: '' };
                return (
                  <div key={stage} className={`p-4 rounded-lg border ${existing ? 'border-gray-200 bg-gray-50' : 'border-blue-100 bg-blue-50/30'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        existing?.status === 'APPROVED' ? 'bg-green-500 text-white' :
                        existing?.status === 'REJECTED' ? 'bg-red-500 text-white' :
                        'bg-gray-200 text-gray-600'
                      }`}>{stage}</div>
                      <span className="text-sm font-medium text-gray-900">{STAGE_LABELS[stage]}</span>
                      {existing && <span className="ml-auto text-xs text-gray-400">Already submitted</span>}
                    </div>

                    {!existing && (
                      <>
                        <div className="flex gap-3 mb-3">
                          {(['APPROVED', 'REJECTED'] as const).map((s) => (
                            <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name={`stage-${stage}`} value={s}
                                checked={decision.status === s}
                                onChange={() => setStageDecisions((prev) => ({ ...prev, [stage]: { ...prev[stage], status: s } }))}
                              />
                              <span className={`text-xs font-medium ${s === 'APPROVED' ? 'text-green-700' : 'text-red-700'}`}>{s}</span>
                            </label>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Notes (optional)"
                          value={decision.notes}
                          onChange={(e) => setStageDecisions((prev) => ({ ...prev, [stage]: { ...prev[stage], notes: e.target.value } }))}
                          className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </>
                    )}

                    {existing && (
                      <p className={`text-xs font-medium ${existing.status === 'APPROVED' ? 'text-green-600' : 'text-red-600'}`}>
                        {existing.status}{existing.notes ? ` — ${existing.notes}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}

              {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}
            </div>

            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => { setReviewAsset(null); setReviewResult(null); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                {reviewResult ? 'Close' : 'Cancel'}
              </button>
              {!reviewResult && (
                <button onClick={submitReview} disabled={reviewSubmitting}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                  {reviewSubmitting ? 'Submitting…' : 'Submit Review'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Rejection Confirmation Modal (on-chain escrow return) ────────── */}
      {rejectConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Confirm On-Chain Rejection</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                <p className="font-semibold mb-1">This action is irreversible on Algorand testnet</p>
                <p>
                  Rejecting Stage {rejectConfirm.stage} of <strong>{rejectConfirm.assetName}</strong> will
                  trigger an on-chain transaction returning{' '}
                  <strong>{rejectConfirm.amountUsdc} USDC</strong> from the issuance escrow contract
                  back to the issuer wallet:
                </p>
                <p className="font-mono text-xs mt-2 break-all text-red-700">{rejectConfirm.issuerWallet}</p>
              </div>
              <p className="text-sm text-gray-600">
                The admin wallet will sign and broadcast the <code>returnToIssuer()</code> inner transaction.
                Confirm to proceed.
              </p>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setRejectConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Go Back
              </button>
              <button
                onClick={() => { setRejectConfirm(null); doSubmitReview(); }}
                className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
                Confirm Reject + Return USDC On-Chain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Distribute Tokens Modal ───────────────────────────────────────── */}
      {distributeAsset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Distribute Tokens</h2>
              <p className="text-sm text-gray-500 mt-1">
                Transfer {distributeAsset.ticker} tokens to the issuer's Pera wallet. SELL orders are automatically seeded at the listing price.
              </p>
            </div>

            <div className="p-6 space-y-4">
              {distributeTxid ? (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-green-700">Tokens transferred on-chain!</p>
                    <p className="text-xs text-green-600 mt-1 break-all">TxID: {distributeTxid}</p>
                    <a href={`https://testnet.algoexplorer.io/tx/${distributeTxid}`} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-2 block">View on AlgoExplorer →</a>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-blue-700">SELL orders auto-seeded!</p>
                    <p className="text-xs text-blue-600 mt-1">
                      {distributeAmount} {distributeAsset.ticker} tokens are now live in the orderbook at listing price.
                      Activate the market to open trading.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Issuer Pera Wallet Address</label>
                    <input value={issuerWallet} onChange={(e) => setIssuerWallet(e.target.value)}
                      placeholder="ALGORAND_ADDRESS..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">Issuer must opt-in to ASA {distributeAsset.asaId} before transfer</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Distribute Amount (tokens)</label>
                    <input type="number" value={distributeAmount} onChange={(e) => setDistributeAmount(e.target.value)}
                      placeholder="e.g. 500000"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">
                      All distributed tokens are immediately seeded as SELL orders at{' '}
                      {distributeAsset.pricePerToken
                        ? `${(Number(distributeAsset.pricePerToken) / 1_000_000).toFixed(2)} USDC`
                        : 'listing price'}.
                    </p>
                  </div>
                  {distributeError && <p className="text-sm text-red-600">{distributeError}</p>}
                </>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setDistributeAsset(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                {distributeTxid ? 'Close' : 'Cancel'}
              </button>
              {!distributeTxid && (
                <button onClick={submitDistribute} disabled={distributeLoading || !issuerWallet || !distributeAmount}
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
                  {distributeLoading ? 'Transferring + seeding…' : 'Distribute & Seed →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
