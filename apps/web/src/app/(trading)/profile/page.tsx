'use client';

import { useRef, useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@txnlab/use-wallet-react';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import styles from './profile.module.css';

interface WhitelistEntry {
  asaId: number;
  isActive: boolean;
  onChainTxId?: string | null;
}

function KycBadge({ tier }: { tier: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    0: { label: 'KYC Tier 0 — Unverified', cls: styles.kycTier0 },
    1: { label: 'KYC Tier 1 — Basic', cls: styles.kycTier1 },
    2: { label: 'KYC Tier 2 — Standard', cls: styles.kycTier2 },
    3: { label: 'KYC Tier 3 — Enhanced', cls: styles.kycTier3 },
  };
  const { label, cls } = map[tier] ?? map[0];
  return <span className={`${styles.kycBadge} ${cls}`}>{label}</span>;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function InvestorProfilePage() {
  const { user, signOut } = useAuth();
  const { activeAddress } = useWallet();
  const tier = user?.kycTier ?? 0;

  const displayName = user?.fullName?.trim() || user?.email?.split('@')[0] || 'Investor';
  const roleBadge = (user?.role ?? 'investor').toLowerCase();
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).getFullYear().toString()
    : '—';

  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2400);
  }, []);

  const { data: whitelist } = useQuery({
    queryKey: ['identity-whitelist', activeAddress],
    enabled: !!activeAddress,
    queryFn: async () => {
      const { data } = await api.get(`/compliance/whitelist/${activeAddress}`);
      return data as WhitelistEntry[];
    },
  });
  const identity = whitelist?.find((e) => e.asaId === 0 && e.isActive);

  const walletStatus = activeAddress ? 'Connected' : 'None';
  const onChainStatus = identity ? 'Registered' : activeAddress ? 'Pending KYC' : 'No wallet';

  return (
    <div className={styles.page}>
      <main className={styles.card}>

        {/* Cover */}
        <div className={styles.cover} />

        {/* Body */}
        <div className={styles.body}>

          {/* Avatar + nav row */}
          <div className={styles.idRow}>
            <div className={styles.avatarFrame}>
              <div className={styles.avatarInner}>
                {initials(displayName) || '?'}
              </div>
            </div>
            <Link href="/markets" className={styles.viewBtn}>
              Markets
            </Link>
          </div>

          {/* Identity */}
          <div className={styles.nameBlock}>
            <h1 className={styles.name}>
              {displayName}
              <span className={styles.roleBadge}>{roleBadge}</span>
            </h1>
            <p className={styles.email}>{user?.email ?? '—'}</p>
          </div>

          {/* Stats */}
          <section className={styles.stats} aria-label="Account stats">
            <div className={styles.stat}>
              <p className={styles.statLabel}>KYC Tier</p>
              <p className={styles.statValue}>{tier}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Wallet</p>
              <p className={styles.statValue}>{walletStatus}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>On-chain</p>
              <p className={styles.statValue}>{onChainStatus}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Member Since</p>
              <p className={styles.statValue}>{memberSince}</p>
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Account details */}
          <section className={styles.section} aria-labelledby="lbl-account">
            <div>
              <p className={styles.sectionLbl} id="lbl-account">Account details</p>
              <p className={styles.sectionSub}>Your name and email associated with this account.</p>
            </div>
            <div className={styles.sectionControl}>
              <p className={styles.fieldValue}>{user?.fullName || '—'}</p>
              <p className={styles.fieldValue} style={{ color: '#79828c', fontSize: 14 }}>{user?.email || '—'}</p>
            </div>
          </section>

          <hr className={styles.rule} />

          {/* KYC status */}
          <section className={styles.section} aria-labelledby="lbl-kyc">
            <div>
              <p className={styles.sectionLbl} id="lbl-kyc">KYC verification</p>
              <p className={styles.sectionSub}>Your identity verification level for trading on ChainStrike.</p>
            </div>
            <div className={styles.sectionControl}>
              <KycBadge tier={tier} />
              {tier === 0 && (
                <Link href="/kyc" className={styles.kycBtn}>
                  Complete KYC verification
                </Link>
              )}
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Wallet */}
          <section className={styles.section} aria-labelledby="lbl-wallet">
            <div>
              <p className={styles.sectionLbl} id="lbl-wallet">Connected wallet</p>
              <p className={styles.sectionSub}>Your Algorand wallet linked to this investor account.</p>
            </div>
            <div className={styles.sectionControl}>
              {activeAddress ? (
                <div className={styles.walletDisplay}>{activeAddress}</div>
              ) : (
                <div className={styles.walletDisplay} style={{ color: '#9aa3ac' }}>
                  No wallet connected — connect via the navigation bar.
                </div>
              )}
            </div>
          </section>

          <hr className={styles.rule} />

          {/* On-chain identity */}
          <section className={styles.section} aria-labelledby="lbl-onchain">
            <div>
              <p className={styles.sectionLbl} id="lbl-onchain">On-chain identity</p>
              <p className={styles.sectionSub}>
                Your verified identity record written to the ChainStrike registry on Algorand.
              </p>
            </div>
            <div className={styles.sectionControl}>
              {identity ? (
                <div className={styles.onChainActive}>
                  <span className={styles.onChainDot} />
                  Registered on-chain
                  {identity.onChainTxId && (
                    <span className={styles.onChainTxId}>
                      — tx {identity.onChainTxId.slice(0, 12)}…
                    </span>
                  )}
                </div>
              ) : !activeAddress ? (
                <p className={styles.fieldValue} style={{ color: '#79828c', fontSize: 14 }}>
                  Connect your wallet via the navigation bar to enable on-chain registration.
                </p>
              ) : tier === 0 ? (
                <p className={styles.fieldValue} style={{ color: '#79828c', fontSize: 14 }}>
                  Complete KYC verification — your on-chain identity will be registered automatically on approval.
                </p>
              ) : (
                <p className={styles.fieldValue} style={{ color: '#79828c', fontSize: 14 }}>
                  Registration in progress — this may take a few minutes to confirm on-chain.
                </p>
              )}
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Sign out */}
          <section className={styles.rowSection} aria-labelledby="lbl-signout">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-signout">Sign out</p>
              <p className={styles.rowSub}>Sign out of your ChainStrike account on this device.</p>
            </div>
            <button
              className={styles.actionBtn}
              type="button"
              onClick={() => signOut()}
            >
              Sign out
            </button>
          </section>

          <hr className={styles.rule} />

          {/* Danger zone */}
          <section className={styles.rowSection} aria-labelledby="lbl-delete">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-delete">Delete account</p>
              <p className={styles.rowSub}>
                Permanently remove your investor account and all associated data. This cannot be undone.
              </p>
            </div>
            <button
              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
              type="button"
              onClick={() => showToast('Deletion requires email confirmation — check your inbox')}
            >
              Delete account
            </button>
          </section>

          <div style={{ height: 32 }} />

        </div>
      </main>

      {/* Toast */}
      <div
        className={`${styles.toast} ${toastVisible ? styles.toastShow : ''}`}
        role="status"
        aria-live="polite"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {toast}
      </div>
    </div>
  );
}
