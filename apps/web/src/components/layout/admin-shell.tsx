'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/providers/auth-provider';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { isAdmin } from '@/lib/auth';
import styles from '@/app/(admin)/admin/admin.module.css';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { status: walletStatus } = useWalletSession({ auto: true });
  const router = useRouter();

  const walletBusy = walletStatus === 'signing' || walletStatus === 'verifying';
  const admin = isAdmin(user);

  useEffect(() => {
    if (loading || walletBusy) return;
    if (!user) {
      router.replace('/login?redirect=%2Fadmin&intent=investor');
    } else if (!admin) {
      router.replace('/markets');
    }
  }, [loading, walletBusy, user, admin, router]);

  if (loading || walletBusy || !user || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Image src="/logo.png" alt="ChainStrike" width={30} height={30} style={{ borderRadius: 6 }} />
          ChainStrike
          <span className={styles.brandTag}>Admin</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.signOut} onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
