'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useWallet } from '@txnlab/use-wallet-react';
import { useAuth } from '@/providers/auth-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState, useEffect, useRef, useCallback } from 'react';
import algosdk from 'algosdk';
import styles from './issuer-navbar.module.css';

const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT   = Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
const ALGOD_TOKEN  = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '';

interface AssetRow {
  id: string;
  name: string;
  ticker: string;
  asaId?: number;
  status: string;
  logoUrl?: string;
  issuerWalletAddress?: string;
}

function useOptInNotifications(activeAddress: string | null) {
  const [optedIn, setOptedIn] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);

  const { data: assets } = useQuery<AssetRow[]>({
    queryKey: ['my-assets-notif'],
    queryFn: async () => {
      const { data } = await api.get('/assets/my');
      return (data as AssetRow[]).filter(
        (a) => a.asaId && ['PRE_MARKET', 'ACTIVE'].includes(a.status),
      );
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!assets?.length) return;
    const addr = activeAddress ?? assets.find((a) => a.issuerWalletAddress)?.issuerWalletAddress;
    if (!addr) return;

    setChecking(true);
    Promise.all(
      assets.map(async (asset) => {
        if (!asset.asaId) return;
        try {
          const r = await fetch(`${ALGOD_SERVER}/v2/accounts/${addr}/assets/${asset.asaId}`);
          if (r.ok) setOptedIn((prev) => new Set([...prev, asset.id]));
        } catch { /* not opted in */ }
      }),
    ).finally(() => setChecking(false));
  }, [assets, activeAddress]);

  const pending = assets?.filter((a) => !optedIn.has(a.id)) ?? [];
  return { pending, optedIn, setOptedIn, checking };
}

export function IssuerNavbar() {
  const { user, signOut } = useAuth();
  const { activeAddress, signTransactions, wallets, activeWallet } = useWallet();
  const pathname = usePathname();
  const qc = useQueryClient();

  const [notifOpen, setNotifOpen] = useState(false);
  const [optInStatus, setOptInStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [optInError, setOptInError] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const { pending, setOptedIn } = useOptInNotifications(activeAddress ?? null);

  const isActive = (href: string) =>
    href === '/issue' ? pathname === '/issue' : pathname === href || pathname.startsWith(href + '/');

  // Close panel on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const handleOptIn = useCallback(async (asset: AssetRow) => {
    if (!activeAddress || !signTransactions || !asset.asaId) return;
    setOptInStatus((p) => ({ ...p, [asset.id]: 'loading' }));
    setOptInError((p) => ({ ...p, [asset.id]: '' }));

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

      setOptInStatus((p) => ({ ...p, [asset.id]: 'done' }));
      setOptedIn((prev) => new Set([...prev, asset.id]));
      qc.invalidateQueries({ queryKey: ['my-assets'] });
      qc.invalidateQueries({ queryKey: ['my-assets-notif'] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Opt-in failed';
      setOptInStatus((p) => ({ ...p, [asset.id]: 'error' }));
      setOptInError((p) => ({ ...p, [asset.id]: msg }));
    }
  }, [activeAddress, signTransactions, setOptedIn, qc]);

  const badgeCount = pending.length;

  return (
    <header className={styles.nav}>
      {/* Logo */}
      <Link href="/" className={styles.logo}>
        <span className={styles.logoImgWrap}>
          <Image src="/logo.png" alt="ChainStrike" width={56} height={56} className={styles.logoImg} />
        </span>
        <span className={styles.logoText}>ChainStrike</span>
      </Link>

      {/* Nav links */}
      <nav className={styles.links}>
        <Link href="/issue/new" className={`${styles.link} ${isActive('/issue/new') ? styles.linkActive : ''}`}>Launch Token</Link>
        <Link href="/issue"     className={`${styles.link} ${isActive('/issue')     ? styles.linkActive : ''}`}>My Issues</Link>
        <Link href="/issue/subscription" className={`${styles.link} ${isActive('/issue/subscription') ? styles.linkActive : ''}`}>Subscriptions</Link>
      </nav>

      {/* Right actions */}
      <div className={styles.actions}>

        {/* Notifications */}
        <div className={styles.notifWrap} ref={panelRef}>
          <button
            className={`${styles.iconBtn} ${badgeCount > 0 ? styles.iconBtnActive : ''}`}
            aria-label="Notifications"
            onClick={() => setNotifOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {badgeCount > 0 && (
              <span className={styles.iconBtnBadge} aria-label={`${badgeCount} notifications`}>
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className={styles.notifPanel}>
              <div className={styles.notifHeader}>
                <span className={styles.notifTitle}>Notifications</span>
                {badgeCount > 0 && (
                  <span className={styles.notifCount}>{badgeCount} pending</span>
                )}
              </div>

              {pending.length === 0 ? (
                <div className={styles.notifEmpty}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c0c0c0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <p>You&apos;re all caught up</p>
                </div>
              ) : (
                <ul className={styles.notifList}>
                  {pending.map((asset) => {
                    const status = optInStatus[asset.id] ?? 'idle';
                    const err = optInError[asset.id];
                    return (
                      <li key={asset.id} className={styles.notifItem}>
                        <div className={styles.notifItemHead}>
                          {asset.logoUrl ? (
                            <img src={asset.logoUrl} alt={asset.ticker} className={styles.notifLogo} />
                          ) : (
                            <div className={styles.notifLogoFallback}>
                              {asset.ticker.slice(0, 2)}
                            </div>
                          )}
                          <div className={styles.notifItemInfo}>
                            <span className={styles.notifItemTicker}>{asset.ticker}</span>
                            <span className={styles.notifItemName}>{asset.name}</span>
                          </div>
                          <span className={styles.notifDot} />
                        </div>

                        <p className={styles.notifMsg}>
                          Your token has been approved and is ready for market. Opt in to your Algorand wallet to receive your initial token allocation.
                        </p>

                        {status === 'done' ? (
                          <div className={styles.notifSuccess}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Opted in successfully
                          </div>
                        ) : (
                          <div className={styles.notifActions}>
                            {!activeAddress ? (
                              <p className={styles.notifWalletNote}>Connect your wallet to opt in</p>
                            ) : (
                              <button
                                className={`${styles.optInBtn} ${status === 'loading' ? styles.optInBtnLoading : ''}`}
                                onClick={() => handleOptIn(asset)}
                                disabled={status === 'loading'}
                              >
                                {status === 'loading' ? (
                                  <>
                                    <span className={styles.spinner} />
                                    Confirm in wallet…
                                  </>
                                ) : (
                                  <>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 12 20 22 4 22 4 12" />
                                      <polyline points="22 7 12 2 2 7" />
                                      <line x1="12" y1="22" x2="12" y2="2" />
                                    </svg>
                                    Opt In to {asset.ticker}
                                  </>
                                )}
                              </button>
                            )}
                            {err && <p className={styles.notifErr}>{err}</p>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Profile */}
        <Link href="/issue/profile" className={styles.iconBtn} aria-label="Profile">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </Link>

        <span className={styles.actionsDivider} />

        {activeAddress ? (
          <button className={styles.btnWallet} onClick={() => activeWallet?.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            className={styles.btnWallet}
            onClick={() => {
              const first = wallets?.[0];
              if (first) first.connect();
            }}
          >
            Connect
          </button>
        )}

        {user ? (
          <button className={styles.btnPrimary} onClick={() => signOut()}>
            Sign out
          </button>
        ) : (
          <Link href="/login" className={styles.btnPrimary}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
