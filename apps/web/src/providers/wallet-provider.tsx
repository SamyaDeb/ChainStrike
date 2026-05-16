'use client';

import { NetworkId, WalletId, WalletManager, WalletProvider as AlgorandWalletProvider, type SupportedWallet } from '@txnlab/use-wallet-react';
import { useMemo } from 'react';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const manager = useMemo(() => {
    const wallets: SupportedWallet[] = [WalletId.PERA, WalletId.DEFLY];
    if (process.env.NEXT_PUBLIC_WC_PROJECT_ID) {
      wallets.push({ id: WalletId.WALLETCONNECT, options: { projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID } });
    }
    return new WalletManager({
      wallets,
      defaultNetwork: (process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'testnet') as NetworkId,
    });
  }, []);

  return <AlgorandWalletProvider manager={manager}>{children}</AlgorandWalletProvider>;
}
