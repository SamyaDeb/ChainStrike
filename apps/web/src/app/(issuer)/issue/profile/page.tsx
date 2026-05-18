'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '@txnlab/use-wallet-react';
import { getCurrentUser, logout } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import styles from './profile.module.css';

interface IssuerStats {
  total: number;
  active: number;
  pending: number;
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

export default function ProfilePage() {
  const user = getCurrentUser();
  const { activeAddress } = useWallet();

  const { data: assets } = useQuery<{ id: string; status: string }[]>({
    queryKey: ['my-assets'],
    queryFn: async () => {
      const { data } = await api.get('/assets/my');
      return data;
    },
    enabled: !!user,
  });

  const stats: IssuerStats = {
    total: assets?.length ?? 0,
    active: assets?.filter((a) => a.status === 'ACTIVE').length ?? 0,
    pending: assets?.filter((a) => ['SUBMITTED', 'UNDER_REVIEW', 'PENDING_REVIEW'].includes(a.status)).length ?? 0,
  };

  // Editable fields
  const [displayName, setDisplayName] = useState(user?.fullName ?? user?.email?.split('@')[0] ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [supportAccess, setSupportAccess] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2400);
  }, []);

  // Track dirty state
  useEffect(() => {
    const initial = { displayName: user?.fullName ?? user?.email?.split('@')[0] ?? '', email: user?.email ?? '' };
    setDirty(displayName !== initial.displayName || email !== initial.email);
  }, [displayName, email, user]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { showToast('Image must be under 500 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    showToast('Changes saved');
    setDirty(false);
  };

  const handleCancel = () => {
    setDisplayName(user?.fullName ?? user?.email?.split('@')[0] ?? '');
    setEmail(user?.email ?? '');
    setDirty(false);
  };

  const handleLogoutAll = () => {
    showToast('Logged out of all other devices');
  };

  const handleDelete = () => {
    showToast('Deletion requires email confirmation — check your inbox');
  };

  const memberSince = '2025'; // placeholder — would come from user.createdAt

  return (
    <div className={styles.page}>
      <main className={styles.card}>

        {/* Cover */}
        <div className={styles.cover}>
          <button
            className={styles.coverHint}
            type="button"
            aria-label="Change cover photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
            Change cover
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>

          {/* Avatar + view-profile row */}
          <div className={styles.idRow}>
            <div
              className={styles.avatarFrame}
              onClick={() => avatarInputRef.current?.click()}
              role="button"
              aria-label="Upload profile photo"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
              )}
              <div className={styles.avatarHint}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/>
                  <circle cx="12" cy="13" r="3.5"/>
                </svg>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
            </div>

            <Link href="/issue" className={styles.viewBtn}>
              My Issues
            </Link>
          </div>

          {/* Identity */}
          <div className={styles.nameBlock}>
            <h1 className={styles.name}>
              {displayName || user?.email?.split('@')[0] || 'Issuer'}
              <span className={styles.roleBadge}>{user?.role ?? 'issuer'}</span>
            </h1>
            <p className={styles.email}>{user?.email ?? '—'}</p>
          </div>

          {/* Stats */}
          <section className={styles.stats} aria-label="Account stats">
            <div className={styles.stat}>
              <p className={styles.statLabel}>Total Assets</p>
              <p className={styles.statValue}>{stats.total}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Active Markets</p>
              <p className={styles.statValue}>{stats.active}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Pending Review</p>
              <p className={styles.statValue}>{stats.pending}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Member Since</p>
              <p className={styles.statValue}>{memberSince}</p>
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Public profile section */}
          <section className={styles.section} aria-labelledby="lbl-public">
            <div>
              <p className={styles.sectionLbl} id="lbl-public">Public profile</p>
              <p className={styles.sectionSub}>This will be displayed on your issuer profile.</p>
            </div>
            <div className={styles.sectionControl}>
              <input
                className={styles.input}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                aria-label="Display name"
              />
              <div className={styles.inputSplit}>
                <span className={styles.inputPrefix}>chainstrike.io/</span>
                <input
                  type="text"
                  value={(displayName || (user?.email?.split('@')[0] ?? '')).toLowerCase().replace(/\s+/g, '-')}
                  readOnly
                  aria-label="Profile URL slug"
                />
              </div>
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Email section */}
          <section className={styles.section} aria-labelledby="lbl-email">
            <div>
              <p className={styles.sectionLbl} id="lbl-email">Email address</p>
              <p className={styles.sectionSub}>Where security alerts and notifications are sent.</p>
            </div>
            <div className={styles.sectionControl}>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                aria-label="Email address"
              />
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Wallet section */}
          <section className={styles.section} aria-labelledby="lbl-wallet">
            <div>
              <p className={styles.sectionLbl} id="lbl-wallet">Connected wallet</p>
              <p className={styles.sectionSub}>Your Algorand wallet linked to this issuer account.</p>
            </div>
            <div className={styles.sectionControl}>
              {activeAddress ? (
                <div className={styles.walletDisplay}>{activeAddress}</div>
              ) : (
                <div className={styles.walletDisplay} style={{ color: '#9aa3ac' }}>No wallet connected</div>
              )}
              <KycBadge tier={user?.kycTier ?? 0} />
              {(user?.kycTier ?? 0) === 0 && (
                <Link href="/issue/kyc" className={styles.kycBtn}>
                  Complete KYC
                </Link>
              )}
            </div>
          </section>

          <hr className={styles.rule} />

          {/* Support access */}
          <section className={styles.rowSection} aria-labelledby="lbl-support">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-support">Support access</p>
              <p className={styles.rowSub}>
                {supportAccess
                  ? 'You have granted ChainStrike support access to your account for compliance assistance.'
                  : 'Support access is currently disabled. Toggle on to grant temporary access.'}
              </p>
            </div>
            <button
              className={`${styles.toggle} ${supportAccess ? styles.toggleOn : ''}`}
              type="button"
              role="switch"
              aria-checked={supportAccess}
              aria-labelledby="lbl-support"
              onClick={() => { setSupportAccess((v) => !v); setDirty(true); }}
            />
          </section>

          <hr className={styles.rule} />

          {/* Log out all devices */}
          <section className={styles.rowSection} aria-labelledby="lbl-logout">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-logout">Log out of all devices</p>
              <p className={styles.rowSub}>Log out of all other active sessions besides this one.</p>
            </div>
            <button className={styles.actionBtn} type="button" onClick={handleLogoutAll}>
              Log out
            </button>
          </section>

          <hr className={styles.rule} />

          {/* Sign out */}
          <section className={styles.rowSection} aria-labelledby="lbl-signout">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-signout">Sign out</p>
              <p className={styles.rowSub}>Sign out of your ChainStrike account on this device.</p>
            </div>
            <button className={styles.actionBtn} type="button" onClick={() => logout()}>
              Sign out
            </button>
          </section>

          <hr className={styles.rule} />

          {/* Danger zone */}
          <section className={styles.rowSection} aria-labelledby="lbl-delete">
            <div className={styles.rowSectionCopy}>
              <p className={styles.rowLbl} id="lbl-delete">Delete account</p>
              <p className={styles.rowSub}>Permanently remove your issuer account and all associated data. This cannot be undone.</p>
            </div>
            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} type="button" onClick={handleDelete}>
              Delete account
            </button>
          </section>

          {/* Footer */}
          <div className={styles.footer}>
            <button className={styles.btnSecondary} type="button" onClick={handleCancel} disabled={!dirty}>
              Cancel
            </button>
            <button className={styles.btnPrimary} type="button" onClick={handleSave} disabled={!dirty}>
              Save changes
            </button>
          </div>

        </div>
      </main>

      {/* Toast */}
      <div className={`${styles.toast} ${toastVisible ? styles.toastShow : ''}`} role="status" aria-live="polite">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {toast}
      </div>
    </div>
  );
}
