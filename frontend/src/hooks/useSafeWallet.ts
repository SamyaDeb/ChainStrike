"use client";

import { useWallet, type Wallet } from "@txnlab/use-wallet-react";
import { useWalletAvailable } from "@/components/wallet-provider";

// Default return type matching useWallet but with null-safe values
export interface SafeWalletState {
  activeAccount: { address: string; name?: string } | null;
  activeWallet: Wallet | null;
  wallets: Wallet[] | null;
  isConnected: boolean;
  isReady: boolean;
  // Use any for signer functions to avoid complex type issues
  signTransactions: ReturnType<typeof useWallet>["signTransactions"] | null;
  transactionSigner: ReturnType<typeof useWallet>["transactionSigner"] | null;
}

const defaultState: SafeWalletState = {
  activeAccount: null,
  activeWallet: null,
  wallets: null,
  isConnected: false,
  isReady: false,
  signTransactions: null,
  transactionSigner: null,
};

/**
 * Safe wrapper around useWallet that handles cases where:
 * - Wallet provider is not initialized
 * - Running on server side
 * - Wallet context is not available
 * 
 * Returns safe default values instead of throwing errors.
 */
export function useSafeWallet(): SafeWalletState {
  const walletAvailable = useWalletAvailable();

  // If wallet context is not available, return defaults
  if (!walletAvailable) {
    return defaultState;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const wallet = useWallet();

  return {
    activeAccount: wallet.activeAccount ?? null,
    activeWallet: wallet.activeWallet ?? null,
    wallets: wallet.wallets ?? null,
    isConnected: !!wallet.activeAccount,
    isReady: true,
    signTransactions: wallet.signTransactions,
    transactionSigner: wallet.transactionSigner,
  };
}

/**
 * Hook to get just the connection status
 */
export function useWalletConnection() {
  const { activeAccount, isReady, wallets } = useSafeWallet();
  
  return {
    isConnected: !!activeAccount,
    isReady,
    address: activeAccount?.address ?? null,
    canConnect: isReady && wallets && wallets.length > 0,
  };
}
