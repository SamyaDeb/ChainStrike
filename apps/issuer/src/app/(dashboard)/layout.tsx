'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout, getStoredToken, getCurrentUser } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { useWallet } from '@/providers/wallet-provider';
import { SettlementSigner } from '@/components/SettlementSigner';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'My Assets' },
  { href: '/dashboard/assets/new', label: 'Tokenize Asset' },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { walletAddress, connect, disconnect } = useWallet();
  const [user, setUser] = useState<{ id: string; email: string; role: string } | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);

  useEffect(() => {
    if (!getStoredToken()) {
      router.push('/login');
      return;
    }
    const u = getCurrentUser();
    if (u && ['ADMIN', 'COMPLIANCE_OFFICER', 'admin', 'compliance_officer'].includes(u.role)) {
      // Admin token stored (e.g. from a previous session) — clear and bounce to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      router.push('/login');
      return;
    }
    setUser(u);
  }, [router]);

  async function handleConnectWallet() {
    setConnectingWallet(true);
    try {
      await connect();
    } finally {
      setConnectingWallet(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        {/* Brand */}
        <div className="p-5 border-b border-gray-200 flex-shrink-0">
          <span className="font-bold text-gray-900">ChainStrike</span>
          <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Issuer</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 text-sm rounded-lg transition-colors ${
                pathname === item.href
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <SettlementSigner />

        {/* Account section */}
        <div className="border-t border-gray-200 p-3 space-y-2 flex-shrink-0">
          {/* User identity card */}
          {user && (
            <div className="px-3 py-2.5 bg-gray-50 rounded-lg space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-600">
                    {user.email[0].toUpperCase()}
                  </span>
                </div>
                <span className="text-xs font-medium text-gray-800 truncate" title={user.email}>
                  {user.email}
                </span>
              </div>

              {/* Wallet row */}
              {walletAddress ? (
                <div className="flex items-center gap-1.5 pl-8">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                  <span
                    className="text-xs font-mono text-gray-500 truncate flex-1"
                    title={walletAddress}
                  >
                    {shortAddr(walletAddress)}
                  </span>
                  <button
                    onClick={disconnect}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Disconnect wallet"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  disabled={connectingWallet}
                  className="pl-8 flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors disabled:opacity-50"
                >
                  {connectingWallet ? (
                    <span className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  )}
                  Connect wallet
                </button>
              )}
            </div>
          )}

          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
