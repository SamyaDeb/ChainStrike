'use client';

import { useEffect } from 'react';
import { useSettlement } from '../hooks/use-settlement';

interface SettlementSignerProps {
  walletAddress: string | null;
  walletSigner: any; // algosdk.TransactionSigner
}

// ─────────────────────────────────────────────────────────────────────────────
// SettlementSigner
//
// Invisible component that maintains the settlement WebSocket connection.
// Place this in your layout or trading page to auto-connect when wallet is available.
// ─────────────────────────────────────────────────────────────────────────────

export function SettlementSigner({ walletAddress, walletSigner }: SettlementSignerProps) {
  const { isConnected } = useSettlement(walletAddress, walletSigner);

  useEffect(() => {
    if (isConnected) {
      console.log('[SettlementSigner] Active and listening for settlement requests');
    }
  }, [isConnected]);

  return null; // Invisible component
}
