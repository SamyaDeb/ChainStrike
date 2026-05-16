'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/providers/wallet-provider';
import { useSettlement } from '@/hooks/use-settlement';

// Renders wallet connect button + monitors settlement sign requests.
// Always mounted in the dashboard layout so issuer is always ready to sign.
export function SettlementSigner() {
  const { walletAddress, connect, disconnect, signer } = useWallet();
  const { isConnected } = useSettlement(walletAddress, signer);
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try { await connect(); } finally { setConnecting(false); }
  }

  return (
    <div className="px-3 py-2 border-t border-gray-200">
      {walletAddress ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <span className="text-xs text-gray-500">{isConnected ? 'Settlement active' : 'Connecting…'}</span>
          </div>
          <p className="text-xs text-gray-400 font-mono truncate">{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</p>
          <button onClick={disconnect} className="text-xs text-gray-400 hover:text-gray-600">Disconnect wallet</button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-200 font-medium disabled:opacity-50"
        >
          {connecting ? 'Connecting…' : 'Connect Pera Wallet'}
        </button>
      )}
    </div>
  );
}
