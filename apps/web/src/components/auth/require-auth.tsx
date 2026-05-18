'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { useWalletSession } from '@/hooks/use-wallet-session';

type Ctx = 'issuer' | 'investor';

// Client route guard. Public paths render freely. Protected paths require a
// session (a connected wallet auto-signs in). KYC is optional — not enforced.
export function RequireAuth({
  context,
  children,
  publicPaths = [],
}: {
  context: Ctx;
  children: React.ReactNode;
  publicPaths?: string[];
}) {
  const { user, loading } = useAuth();
  const { status: walletStatus } = useWalletSession({ auto: true });
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const walletBusy = walletStatus === 'signing' || walletStatus === 'verifying';

  useEffect(() => {
    if (loading || isPublic || user || walletBusy) return;
    const redirect = encodeURIComponent(pathname);
    router.replace(`/login?redirect=${redirect}&intent=${context}`);
  }, [loading, isPublic, user, walletBusy, pathname, router, context]);

  if (isPublic) return <>{children}</>;

  if (loading || walletBusy || (!user && !walletBusy)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    );
  }

  return <>{children}</>;
}
