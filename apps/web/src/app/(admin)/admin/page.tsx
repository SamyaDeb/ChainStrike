'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import styles from './admin.module.css';

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
  logoUrl?: string;
  issuanceEscrowStatus?: 'PENDING' | 'RELEASED_TO_VAULT' | 'RETURNED_TO_ISSUER';
  issuanceEscrowAmount?: string;
  issuanceEscrowTxId?: string;
  issuanceEscrowReleaseTxId?: string;
}

interface AmlAlert {
  id: string; alertType: string; severity: string; walletAddress: string;
  description: string; status: string; createdAt: string;
}

function escrowChipClass(s?: string): string {
  if (s === 'RELEASED_TO_VAULT') return styles.chipApproved;
  if (s === 'RETURNED_TO_ISSUER') return styles.chipRejected;
  return styles.chipPending;
}

function verificationChipClass(s: string): string {
  if (s === 'APPROVED') return styles.chipApproved;
  if (s === 'REJECTED') return styles.chipRejected;
  return styles.chipPending;
}

function statusChipClass(s: string): string {
  if (s === 'ACTIVE') return styles.chipActive;
  if (s === 'PRE_MARKET') return styles.chipNeutral;
  return styles.chipNeutral;
}

export default function AdminDashboard() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [alerts, setAlerts] = useState<AmlAlert[]>([]);
  const [tab, setTab] = useState<'assets' | 'aml' | 'users'>('assets');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [reviewAsset, setReviewAsset] = useState<Asset | null>(null);
  const [stageDecisions, setStageDecisions] = useState<Record<number, { status: 'APPROVED' | 'REJECTED'; notes: string }>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewResult, setReviewResult] = useState<{ returnTxId?: string; stage?: number } | null>(null);

  const [rejectConfirm, setRejectConfirm] = useState<{ assetId: string; assetName: string; stage: number; issuerWallet: string; amountUsdc: string } | null>(null);


  useEffect(() => { loadData(); }, []);

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

    } finally {
      setLoading(false);
    }
  }

  function openReview(asset: Asset) {
    const initial: Record<number, { status: 'APPROVED' | 'REJECTED'; notes: string }> = {};
    for (let s = 1; s <= 5; s++) {
      const existing = asset.verificationLogs?.find((l) => l.stage === s);
      initial[s] = { status: (existing?.status as 'APPROVED' | 'REJECTED') ?? 'APPROVED', notes: existing?.notes ?? '' };
    }
    setStageDecisions(initial);
    setReviewError('');
    setReviewResult(null);
    setReviewAsset(asset);
  }

  async function submitReview() {
    if (!reviewAsset) return;
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
          if (stageDecisions[stage].status === 'REJECTED' && res.data?.issuanceEscrowReleaseTxId) {
            setReviewResult({ returnTxId: res.data.issuanceEscrowReleaseTxId, stage });
          }
        }
      }
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setReviewError(e?.response?.data?.message ?? 'Failed to submit review');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function deployAsa(assetId: string) {
    setActionLoading(assetId + ':deploy');
    try {
      await api.patch(`/assets/${assetId}/deploy-asa`, undefined, { timeout: 180_000 });
      await loadData();
    } catch (err: unknown) {
      const e = err as { code?: string; response?: { data?: { message?: string } } };
      if (e.code === 'ECONNABORTED') {
        alert('Deploy is taking longer than expected. Refresh in 30 seconds — it likely succeeded on-chain.');
      } else {
        alert(e?.response?.data?.message ?? 'Deploy failed');
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function activateMarket(assetId: string) {
    setActionLoading(assetId + ':activate');
    try {
      await api.patch(`/assets/${assetId}/activate`, undefined, { timeout: 180_000 });
      await loadData();
    } catch (err: unknown) {
      const e = err as { code?: string; response?: { data?: { message?: string } } };
      if (e.code === 'ECONNABORTED') {
        alert('Activate is taking longer than expected. Refresh in 30 seconds — it likely succeeded on-chain.');
      } else {
        alert(e?.response?.data?.message ?? 'Activate market failed');
      }
    } finally {
      setActionLoading(null);
    }
  }

  const pendingAssets  = assets.filter((a) => ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].includes(a.verificationStatus));
  const approvedAssets = assets.filter((a) => a.verificationStatus === 'APPROVED' && !a.asaId);
  const preMarketAssets = assets.filter((a) => a.status === 'PRE_MARKET');
  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  const stats = [
    { label: 'Pending Review', value: pendingAssets.length, alert: false },
    { label: 'Ready to Deploy', value: approvedAssets.length, alert: false },
    { label: 'Pre-Market', value: preMarketAssets.length, alert: false },
    { label: 'AML Alerts (Open)', value: openAlerts.length, alert: openAlerts.length > 0 },
  ];

  return (
    <div className={styles.main}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Administration</h1>
        <p className={styles.pageSub}>Asset verification pipeline, on-chain deployment, and compliance.</p>
      </div>

      <div className={styles.statsGrid}>
        {stats.map((s) => (
          <div key={s.label} className={styles.statCard}>
            <p className={styles.statLabel}>{s.label}</p>
            <p className={`${styles.statValue} ${s.alert ? styles.statValueAlert : ''}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className={styles.tabs}>
        {(['assets', 'aml', 'users'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
          >
            {t === 'aml' ? 'AML Alerts' : t === 'assets' ? 'Asset Pipeline' : 'Users'}
          </button>
        ))}
      </div>

      {tab === 'assets' && (
        loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : assets.length === 0 ? (
          <div className={styles.empty}>No assets in the pipeline yet.</div>
        ) : (
          <div className={styles.cards}>
            {assets.map((asset) => {
              return (
                <div key={asset.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <div className={styles.cardIcon}>
                      {asset.logoUrl
                        ? <img src={asset.logoUrl} alt={asset.ticker} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
                        : asset.ticker.slice(0, 2).toUpperCase()}
                    </div>
                    <div className={styles.cardHeadInfo}>
                      <p className={styles.cardName}>{asset.name}</p>
                      <p className={styles.cardTicker}>{asset.ticker}</p>
                    </div>
                  </div>

                  <div className={styles.cardMeta}>
                    <span className={styles.chip}>{asset.category.toLowerCase().replace(/_/g, ' ')}</span>
                    <span className={`${styles.chip} ${verificationChipClass(asset.verificationStatus)}`}>
                      {asset.verificationStatus}
                    </span>
                    <span className={`${styles.chip} ${statusChipClass(asset.status)}`}>
                      {asset.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <hr className={styles.cardDivider} />

                  <div className={styles.cardGrid}>
                    <div>
                      <p className={styles.cardStatLabel}>Verification</p>
                      <p className={styles.cardStatValue}>
                        {asset.verificationLogs?.filter((l) => l.status === 'APPROVED').length ?? 0}/5 stages
                      </p>
                    </div>
                    <div>
                      <p className={styles.cardStatLabel}>ASA ID</p>
                      <p className={styles.cardStatValue}>{asset.asaId ?? '—'}</p>
                    </div>
                    <div>
                      <p className={styles.cardStatLabel}>Escrow</p>
                      {asset.issuanceEscrowStatus ? (
                        <p className={styles.cardStatValue}>
                          <span className={`${styles.chip} ${escrowChipClass(asset.issuanceEscrowStatus)}`}>
                            {asset.issuanceEscrowStatus === 'RELEASED_TO_VAULT' ? 'Released'
                              : asset.issuanceEscrowStatus === 'RETURNED_TO_ISSUER' ? 'Returned' : 'Pending'}
                          </span>
                        </p>
                      ) : (
                        <p className={styles.cardStatValue}>—</p>
                      )}
                    </div>
                    <div>
                      <p className={styles.cardStatLabel}>Escrow Amount</p>
                      <p className={styles.cardStatValue}>
                        {asset.issuanceEscrowAmount
                          ? `${(Number(asset.issuanceEscrowAmount) / 1_000_000).toLocaleString()} USDC`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {asset.issuanceEscrowReleaseTxId && (
                    <a
                      href={`https://testnet.explorer.perawallet.app/tx/${asset.issuanceEscrowReleaseTxId}`}
                      target="_blank" rel="noreferrer" className={styles.txLink}
                    >
                      View escrow tx ↗
                    </a>
                  )}

                  <div className={styles.cardActions}>
                    {asset.verificationStatus !== 'APPROVED' && (
                      <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={() => openReview(asset)}>
                        Review
                      </button>
                    )}
                    {asset.verificationStatus === 'APPROVED' && !asset.asaId && (
                      <button
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                        onClick={() => deployAsa(asset.id)}
                        disabled={actionLoading === asset.id + ':deploy'}
                      >
                        {actionLoading === asset.id + ':deploy' ? 'Deploying…' : 'Deploy ASA'}
                      </button>
                    )}
                    {asset.status === 'PRE_MARKET' && (
                      <button
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                        onClick={() => activateMarket(asset.id)}
                        disabled={actionLoading === asset.id + ':activate'}
                      >
                        {actionLoading === asset.id + ':activate' ? 'Activating…' : 'Activate Market'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'aml' && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {['Type', 'Severity', 'Wallet', 'Description', 'Status', 'Date'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9a9a9a', padding: '40px' }}>No alerts</td></tr>
              ) : alerts.map((alert) => (
                <tr key={alert.id}>
                  <td style={{ fontWeight: 600 }}>{alert.alertType.replace(/_/g, ' ')}</td>
                  <td>
                    <span className={`${styles.chip} ${alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? styles.chipRejected : styles.chipPending}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className={styles.mono}>{alert.walletAddress.slice(0, 8)}…{alert.walletAddress.slice(-6)}</td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.description}</td>
                  <td>
                    <span className={`${styles.chip} ${alert.status === 'OPEN' ? styles.chipRejected : styles.chipNeutral}`}>
                      {alert.status}
                    </span>
                  </td>
                  <td className={styles.mono}>{new Date(alert.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div className={styles.empty}>
          User management — connect to identity service to view KYC status, roles, and account actions.
        </div>
      )}

      {/* ── 5-Stage Review Modal ── */}
      {reviewAsset && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Review: {reviewAsset.name} ({reviewAsset.ticker})</h2>
              <p className={styles.modalSub}>Submit decisions for each verification stage.</p>
            </div>
            <div className={styles.modalBody}>
              {reviewAsset.issuanceEscrowStatus === 'PENDING' && reviewAsset.issuanceEscrowAmount && (
                <div className={`${styles.banner} ${styles.bannerWarn}`}>
                  <p className={styles.bannerTitle}>On-chain escrow</p>
                  {(Number(reviewAsset.issuanceEscrowAmount) / 1_000_000).toLocaleString()} USDC held in escrow.
                  Approving Stage 5 releases it to vault on Deploy ASA. Any rejection returns it to the issuer immediately.
                </div>
              )}
              {reviewResult?.returnTxId && (
                <div className={`${styles.banner} ${styles.bannerDanger}`}>
                  <p className={styles.bannerTitle}>USDC returned to issuer on-chain</p>
                  <p className={styles.bannerMono}>{reviewResult.returnTxId}</p>
                  <a href={`https://testnet.explorer.perawallet.app/tx/${reviewResult.returnTxId}`} target="_blank" rel="noreferrer" className={styles.txLink}>
                    View on AlgoExplorer ↗
                  </a>
                </div>
              )}
              {[1, 2, 3, 4, 5].map((stage) => {
                const existing = reviewAsset.verificationLogs?.find((l) => l.stage === stage);
                const decision = stageDecisions[stage] ?? { status: 'APPROVED', notes: '' };
                const numClass = existing?.status === 'APPROVED' ? styles.stageNumApproved
                  : existing?.status === 'REJECTED' ? styles.stageNumRejected : '';
                return (
                  <div key={stage} className={`${styles.stage} ${existing ? styles.stageDone : ''}`}>
                    <div className={styles.stageHead}>
                      <div className={`${styles.stageNum} ${numClass}`}>{stage}</div>
                      <span className={styles.stageName}>{STAGE_LABELS[stage]}</span>
                      {existing && <span className={styles.stageTag}>Already submitted</span>}
                    </div>
                    {!existing ? (
                      <>
                        <div className={styles.radioRow}>
                          {(['APPROVED', 'REJECTED'] as const).map((s) => (
                            <label key={s} className={`${styles.radio} ${s === 'APPROVED' ? styles.radioApproved : styles.radioRejected}`}>
                              <input
                                type="radio"
                                name={`stage-${stage}`}
                                value={s}
                                checked={decision.status === s}
                                onChange={() => setStageDecisions((prev) => ({ ...prev, [stage]: { ...prev[stage], status: s } }))}
                              />
                              {s}
                            </label>
                          ))}
                        </div>
                        <input
                          className={styles.input}
                          type="text"
                          placeholder="Notes (optional)"
                          value={decision.notes}
                          onChange={(e) => setStageDecisions((prev) => ({ ...prev, [stage]: { ...prev[stage], notes: e.target.value } }))}
                        />
                      </>
                    ) : (
                      <p className={`${styles.stageResult} ${existing.status === 'APPROVED' ? styles.stageResultApproved : styles.stageResultRejected}`}>
                        {existing.status}{existing.notes ? ` — ${existing.notes}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
              {reviewError && <p className={styles.errText}>{reviewError}</p>}
            </div>
            <div className={styles.modalFoot}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => { setReviewAsset(null); setReviewResult(null); }}
              >
                {reviewResult ? 'Close' : 'Cancel'}
              </button>
              {!reviewResult && (
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={submitReview} disabled={reviewSubmitting}>
                  {reviewSubmitting ? 'Submitting…' : 'Submit Review'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Rejection Confirmation Modal ── */}
      {rejectConfirm && (
        <div className={styles.overlay}>
          <div className={`${styles.modal} ${styles.modalSm}`}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Confirm On-Chain Rejection</h2>
            </div>
            <div className={styles.modalBody}>
              <div className={`${styles.banner} ${styles.bannerDanger}`}>
                <p className={styles.bannerTitle}>This action is irreversible on Algorand testnet</p>
                Rejecting Stage {rejectConfirm.stage} of <strong>{rejectConfirm.assetName}</strong> triggers an
                on-chain transaction returning <strong>{rejectConfirm.amountUsdc} USDC</strong> from the issuance
                escrow contract back to the issuer wallet:
                <p className={styles.bannerMono}>{rejectConfirm.issuerWallet}</p>
              </div>
              <p className={styles.modalSub}>
                The admin wallet signs and broadcasts the <code>returnToIssuer()</code> inner transaction.
              </p>
            </div>
            <div className={styles.modalFoot}>
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setRejectConfirm(null)}>
                Go Back
              </button>
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => { setRejectConfirm(null); doSubmitReview(); }}
              >
                Confirm Reject &amp; Return USDC
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
