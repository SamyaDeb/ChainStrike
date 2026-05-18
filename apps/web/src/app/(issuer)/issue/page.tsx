'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@txnlab/use-wallet-react';
import Link from 'next/link';
import styles from './issue.module.css';

const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';

const ASSET_COLORS = [
  '#76b900', '#0b1c3a', '#6b4fe6', '#1f4d3a', '#c62828',
  '#e23b1f', '#0071c5', '#ff8a3d', '#8a6cf5', '#1f9b5e',
  '#b8860b', '#2196f3', '#9c27b0', '#e91e63', '#ff5722',
];

function getColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return ASSET_COLORS[h % ASSET_COLORS.length];
}

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Metals',
  REAL_ESTATE:     'Real Estate',
  PRIVATE_DEBT:    'Private Debt',
  CORPORATE_BOND:  'Bonds',
  COMMODITY:       'Commodity',
  PRIVATE_EQUITY:  'Equity',
};

const STATUS_CLASS_MAP: Record<string, string> = {
  DRAFT:          'statusDraft',
  SUBMITTED:      'statusSubmitted',
  UNDER_REVIEW:   'statusUnderReview',
  APPROVED:       'statusApproved',
  PRE_MARKET:     'statusPreMarket',
  ACTIVE:         'statusActive',
  SUSPENDED:      'statusSuspended',
  REJECTED:       'statusRejected',
  PAUSED:         'statusPaused',
  PENDING_REVIEW: 'statusPendingReview',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT:          'Draft',
  SUBMITTED:      'Submitted',
  UNDER_REVIEW:   'Under Review',
  APPROVED:       'Approved',
  PRE_MARKET:     'Pre-Market',
  ACTIVE:         'Active',
  SUSPENDED:      'Suspended',
  REJECTED:       'Rejected',
  PAUSED:         'Paused',
  PENDING_REVIEW: 'Pending Review',
};

function getStatusClass(status: string): string {
  return styles[STATUS_CLASS_MAP[status] ?? 'statusDraft'] as string;
}

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
  logoUrl?: string;
  createdAt: string;
}

interface AssetCardProps {
  asset: AssetRow;
  optInStatus: Record<string, 'loading' | 'opted-in' | 'not-opted-in'>;
  tokenBalances: Record<string, string>;
}

function AssetCard({ asset, optInStatus, tokenBalances }: AssetCardProps) {
  const needsOptIn = asset.asaId && ['PRE_MARKET', 'ACTIVE'].includes(asset.status);
  const status     = optInStatus[asset.id];
  const balance    = tokenBalances[asset.id];

  const allocationTokens = asset.liquidityDepositUsdc && asset.pricePerToken
    ? Math.floor(Number(asset.liquidityDepositUsdc) / Number(asset.pricePerToken))
    : null;

  const iconInitials = asset.ticker.slice(0, 2).toUpperCase();
  const catLabel = CATEGORY_LABELS[asset.category] ?? asset.category.toLowerCase().replace(/_/g, ' ');

  return (
    <div className={styles.card}>
      {/* Head */}
      <div className={styles.cardHead}>
        <div
          className={styles.cardIcon}
          style={asset.logoUrl
            ? { background: 'transparent', border: '1px solid #ececec', overflow: 'hidden' }
            : { background: getColor(asset.ticker) }
          }
        >
          {asset.logoUrl
            ? <img src={asset.logoUrl} alt={asset.ticker} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : iconInitials
          }
        </div>
        <div className={styles.cardHeadInfo}>
          <Link href={`/issue/${asset.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className={styles.cardTicker}>{asset.ticker}</div>
            <div className={styles.cardSub}>{asset.name}</div>
          </Link>
          <div className={styles.cardMeta}>
            <span className={styles.catBadge}>{catLabel}</span>
            {asset.asaId && <span className={styles.asaChip}>ASA {asset.asaId}</span>}
            <span className={`${styles.statusBadge} ${getStatusClass(asset.status)}`}>
              {STATUS_LABELS[asset.status] ?? asset.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      <hr className={styles.cardDivider} />

      {/* Stats row */}
      <div className={styles.cardStats}>
        <div className={styles.statItem}>
          <p className={styles.statItemLabel}>Supply</p>
          <p className={styles.statItemValue}>
            {(Number(asset.totalSupply) / 1_000_000).toLocaleString()}
          </p>
          {needsOptIn && status === 'not-opted-in' && allocationTokens !== null && (
            <p className={styles.allocationLine}>~{allocationTokens.toLocaleString()} {asset.ticker}</p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className={styles.statItemLabel} style={{ textAlign: 'right' }}>Price</p>
          <p className={styles.priceBig}>${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)}</p>
        </div>
      </div>

      {/* Opt-in footer */}
      {needsOptIn && (
        <div className={styles.cardFooter}>
          {status === 'loading' ? (
            <div className={styles.optInChecking}>Checking opt-in status…</div>
          ) : status === 'opted-in' ? (
            <>
              <div className={styles.optedInBadge}>
                <span className={styles.optedInDot} />
                Opted In
              </div>
              {balance !== undefined && (
                <p className={styles.balanceLine}>
                  You hold: {(Number(balance) / 1_000_000).toLocaleString()} {asset.ticker}
                  {Number(balance) === 0 && allocationTokens !== null && (
                    <> — awaiting {allocationTokens.toLocaleString()} (ask admin)</>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className={styles.optInHint}>
              Opt-in required — check the notifications bell to receive your tokens.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyIssuePage() {
  const { activeAddress } = useWallet();

  const { data: assets, isLoading } = useQuery({
    queryKey: ['my-assets'],
    queryFn: async () => {
      const { data } = await api.get('/assets/my');
      return data as AssetRow[];
    },
    refetchOnMount: 'always',
  });

  const [optInStatus, setOptInStatus] = useState<Record<string, 'loading' | 'opted-in' | 'not-opted-in'>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});

  const checkOptIns = useCallback(async (rows: AssetRow[], wallet: string | null) => {
    const relevant = rows.filter(
      (a) => a.asaId && (a.status === 'PRE_MARKET' || a.status === 'ACTIVE'),
    );
    if (!relevant.length) return;

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
          const s = r.ok ? 'opted-in' : 'not-opted-in';
          if (r.ok) {
            const d = await r.json();
            const holding = d['asset-holding'] ?? d.assetHolding;
            const bal = holding?.amount ?? 0;
            setTokenBalances((prev) => ({ ...prev, [asset.id]: String(bal) }));
          }
          setOptInStatus((prev) => ({ ...prev, [asset.id]: s as 'opted-in' | 'not-opted-in' }));
        } catch {
          setOptInStatus((prev) => ({ ...prev, [asset.id]: 'not-opted-in' }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    if (assets) checkOptIns(assets, activeAddress ?? null);
  }, [assets, activeAddress, checkOptIns]);

  const stats = {
    total:   assets?.length ?? 0,
    active:  assets?.filter((a) => a.status === 'ACTIVE').length ?? 0,
    pending: assets?.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length ?? 0,
  };

  return (
    <div className={styles.page}>
      <div className={styles.main}>

        {/* Page header */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>My Issued Assets</h1>
            <p className={styles.pageSub}>Track and manage your tokenized real-world assets.</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className={styles.statsGrid}>
          {[
            { label: 'Total Assets',   value: stats.total },
            { label: 'Active Markets', value: stats.active },
            { label: 'Pending Review', value: stats.pending },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <p className={styles.statLabel}>{s.label}</p>
              <p className={styles.statValue}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Section header */}
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Your Assets</div>
          {assets?.length ? <span className={styles.chip}>{assets.length}</span> : null}
        </div>

        {/* Card grid / empty / loading */}
        {isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : !assets?.length ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No assets yet</p>
            <p className={styles.emptyBody}>
              You haven&apos;t issued any tokens yet.<br />
              Tokenize your first real-world asset to get started.
            </p>
          </div>
        ) : (
          <div className={styles.cards}>
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                optInStatus={optInStatus}
                tokenBalances={tokenBalances}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
