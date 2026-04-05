"use client";

import React, { type ReactNode, useEffect, useState, createContext, useContext } from "react";

// Context to track if wallet is available
export const WalletAvailableContext = createContext<boolean>(false);

export function useWalletAvailable() {
  return useContext(WalletAvailableContext);
}

export function WalletProviderWrapper({ children }: { children: ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Provider, setProvider] = useState<React.ComponentType<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [walletManager, setWalletManager] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initWallet() {
      try {
        // Wait for client-side hydration
        if (typeof window === "undefined") {
          return;
        }

        // Small delay to ensure DOM is fully ready
        await new Promise(resolve => setTimeout(resolve, 150));

        // Dynamically import wallet modules
        const walletModule = await import("@txnlab/use-wallet-react");
        
        if (!mounted) return;

        // Create wallet manager
        const manager = new walletModule.WalletManager({
          wallets: [walletModule.WalletId.PERA],
          defaultNetwork: walletModule.NetworkId.TESTNET,
        });

        if (!mounted) return;

        setProvider(() => walletModule.WalletProvider);
        setWalletManager(manager);
        setIsLoading(false);
      } catch (err) {
        console.error("Failed to initialize wallet:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load wallet");
          setIsLoading(false);
        }
      }
    }

    initWallet();

    return () => {
      mounted = false;
    };
  }, []);

  // Still loading
  if (isLoading) {
    return (
      <WalletAvailableContext.Provider value={false}>
        <div className="min-h-screen bg-dark-950 flex items-center justify-center">
          <div className="text-gray-400 animate-pulse">Loading wallet...</div>
        </div>
      </WalletAvailableContext.Provider>
    );
  }

  // Error or wallet not available - render app without wallet
  if (error || !Provider || !walletManager) {
    console.warn("Running without wallet support:", error);
    return (
      <WalletAvailableContext.Provider value={false}>
        {children}
      </WalletAvailableContext.Provider>
    );
  }

  // Render with wallet support
  return (
    <WalletAvailableContext.Provider value={true}>
      <Provider manager={walletManager}>{children}</Provider>
    </WalletAvailableContext.Provider>
  );
}
