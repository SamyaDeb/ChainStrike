'use client';

import { NetworkId, WalletId, WalletManager, WalletProvider as AlgorandWalletProvider } from '@txnlab/use-wallet-react';
import { useMemo } from 'react';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const manager = useMemo(
    () =>
      new WalletManager({
        wallets: [
          WalletId.PERA,
          WalletId.DEFLY,
          ...(process.env.NEXT_PUBLIC_WC_PROJECT_ID
            ? [{ id: WalletId.WALLETCONNECT, options: { projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID } }]
            : []),
        ],
        network: (process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'mainnet') as NetworkId,
      }),
    [],
  );

  return <AlgorandWalletProvider manager={manager}>{children}</AlgorandWalletProvider>;
}
