'use client';

import Link from 'next/link';
import { useWallet } from '@txnlab/use-wallet-react';
import { logout, isAuthenticated } from '@/lib/auth';
import { useEffect, useState } from 'react';

export function Navbar() {
  const { activeAddress, wallets, activeWallet } = useWallet();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  const shortAddress = activeAddress
    ? `${activeAddress.slice(0, 4)}…${activeAddress.slice(-4)}`
    : null;

  return (
    <header className="h-14 bg-[#1A1D27] border-b border-[#2A2D3A] flex items-center px-6 gap-6">
      <Link href="/" className="font-bold text-white">
        Chain<span className="text-blue-500">Strike</span>
      </Link>

      <nav className="flex items-center gap-4 text-sm text-gray-400">
        <Link href="/markets" className="hover:text-white transition-colors">Markets</Link>
        <Link href="/portfolio" className="hover:text-white transition-colors">Portfolio</Link>
        <Link href="/kyc" className="hover:text-white transition-colors">KYC</Link>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {/* Wallet connection */}
        {activeAddress ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-sm font-mono text-gray-300">{shortAddress}</span>
            <button
              onClick={() => activeWallet?.disconnect()}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {wallets?.map((wallet) => (
              <button
                key={wallet.id}
                onClick={() => wallet.connect()}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                {wallet.metadata.name}
              </button>
            ))}
          </div>
        )}

        {/* Account auth */}
        {authed ? (
          <button
            onClick={logout}
            className="text-xs text-gray-500 hover:text-white transition-colors border border-[#2A2D3A] px-3 py-1.5 rounded-lg"
          >
            Sign out
          </button>
        ) : (
          <Link
            href="/login"
            className="text-xs px-3 py-1.5 border border-[#2A2D3A] text-gray-300 hover:text-white hover:border-gray-500 rounded-lg transition-colors"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
