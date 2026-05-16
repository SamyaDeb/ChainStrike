'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import algosdk from 'algosdk';

interface WalletContextValue {
  walletAddress: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signer: ((txns: Uint8Array[], signerIndices: number[]) => Promise<Uint8Array[]>) | null;
  signChallenge: (nonce: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue>({
  walletAddress: null,
  connect: async () => {},
  disconnect: () => {},
  signer: null,
  signChallenge: async () => { throw new Error('Wallet not connected'); },
});

export function useWallet() {
  return useContext(WalletContext);
}

// Module-level singleton — one instance for the entire app lifetime.
// Re-creating PeraWalletConnect wipes the WalletConnect bridge session and
// prevents the QR modal / browser extension from opening correctly.
let _peraInstance: any = null;
let _peraPromise: Promise<any> | null = null;

async function getPeraWallet(): Promise<any> {
  if (_peraInstance) return _peraInstance;
  if (_peraPromise) return _peraPromise;

  _peraPromise = import('@perawallet/connect').then(({ PeraWalletConnect }) => {
    _peraInstance = new PeraWalletConnect({
      shouldShowSignTxnToast: true,
      // 416002 = testnet  |  416001 = mainnet  |  4160 = any network
      chainId: 416002,
    });
    return _peraInstance;
  });

  return _peraPromise;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // Keep a ref so signer/signChallenge callbacks always see the latest instance
  // without needing it as a dep (avoids stale-closure bugs).
  const peraRef = useRef<any>(null);

  // On mount: restore previous session from localStorage if one exists.
  // This makes the wallet "auto-reconnect" after a page reload.
  useEffect(() => {
    let cancelled = false;
    getPeraWallet().then(async (pera) => {
      peraRef.current = pera;
      try {
        const accounts = await pera.reconnectSession();
        if (!cancelled && accounts?.[0]) setWalletAddress(accounts[0]);
      } catch {
        // No existing session — that is fine, user will click Connect.
      }
    });
    return () => { cancelled = true; };
  }, []);

  const connect = useCallback(async () => {
    const pera = await getPeraWallet();
    peraRef.current = pera;
    try {
      // connect() opens the Pera modal (QR code + extension button).
      const accounts = await pera.connect();
      if (accounts?.[0]) setWalletAddress(accounts[0]);
    } catch (err: any) {
      // User closed the modal — not an error we surface.
      if (err?.data?.type === 'CONNECT_MODAL_CLOSED') return;
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    peraRef.current?.disconnect().catch(() => {});
    setWalletAddress(null);
  }, []);

  const signer = useCallback(
    async (txns: Uint8Array[], signerIndices: number[]): Promise<Uint8Array[]> => {
      const pera = peraRef.current;
      const addr = walletAddress;
      if (!pera || !addr) throw new Error('Wallet not connected');

      const txnsToSign = txns.map((txn, i) => ({
        txn: algosdk.decodeUnsignedTransaction(txn),
        signers: signerIndices.includes(i) ? [addr] : [],
      }));
      const signed: (Uint8Array | null)[] = await pera.signTransaction([txnsToSign]);
      return signed.map((s) => s ?? new Uint8Array(0));
    },
    [walletAddress],
  );

  // Signs a challenge nonce via Pera signData for wallet-based login.
  // Pera prepends the "MX" prefix automatically, matching algosdk.verifyBytes.
  const signChallenge = useCallback(
    async (nonce: string): Promise<string> => {
      const pera = peraRef.current;
      const addr = walletAddress;
      if (!pera || !addr) throw new Error('Wallet not connected');

      const results: Uint8Array[] = await pera.signData(
        [{ data: new TextEncoder().encode(nonce), message: 'ChainStrike — Sign in with your wallet' }],
        addr,
      );
      return Buffer.from(results[0]).toString('base64');
    },
    [walletAddress],
  );

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        connect,
        disconnect,
        signer: walletAddress ? signer : null,
        signChallenge,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
