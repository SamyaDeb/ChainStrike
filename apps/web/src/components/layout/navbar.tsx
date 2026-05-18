'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useWallet } from '@txnlab/use-wallet-react';
import { useAuth } from '@/providers/auth-provider';
import styles from './navbar.module.css';

export function Navbar() {
  const { activeAddress, wallets, activeWallet } = useWallet();
  const { user, signOut } = useAuth();
  const authed = !!user;
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

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
        <Link href="/markets" className={`${styles.link} ${isActive('/markets') ? styles.linkActive : ''}`}>Markets</Link>
        <Link href="/liquidity" className={`${styles.link} ${isActive('/liquidity') ? styles.linkActive : ''}`}>Liquidity</Link>
        <Link href="/portfolio" className={`${styles.link} ${isActive('/portfolio') ? styles.linkActive : ''}`}>Portfolio</Link>
      </nav>

      {/* Search */}
      <div className={styles.search}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="#9a9a9a" strokeWidth="2" />
          <path d="m20 20-3.2-3.2" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input className={styles.searchInput} type="text" placeholder="Search assets, markets…" />
      </div>

      {/* Right actions */}
      <div className={styles.actions}>
        {/* Profile (investor context) */}
        {authed && (
          <Link href="/profile" className={styles.iconBtn} aria-label="Profile">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
        )}

        {/* Wallet */}
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

        {/* Auth */}
        {authed ? (
          <button className={styles.btnPrimary} onClick={() => signOut()}>
            Sign out
          </button>
        ) : (
          <Link
            href={`/login?redirect=${encodeURIComponent(pathname)}&intent=investor`}
            className={styles.btnPrimary}
          >
            Sign in / Sign up
          </Link>
        )}
      </div>
    </header>
  );
}
