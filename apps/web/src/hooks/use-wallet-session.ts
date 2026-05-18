'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { walletChallenge, walletLogin } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

export type WalletSessionStatus = 'idle' | 'signing' | 'verifying' | 'error';

// Encapsulates the challenge -> sign -> wallet-login flow (mirrors login/page.tsx)
// so a connected wallet becomes an authenticated session anywhere in the app.
export function useWalletSession(options: { auto?: boolean } = {}) {
  const { activeAddress, signTransactions } = useWallet();
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState<WalletSessionStatus>('idle');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const signIn = useCallback(async () => {
    if (!activeAddress || !signTransactions) {
      setError('Wallet not ready. Connect your wallet first.');
      setStatus('error');
      return false;
    }
    if (inFlight.current) return false;
    inFlight.current = true;
    setError('');
    setStatus('signing');
    try {
      const { nonce } = await walletChallenge(activeAddress);
      const algod = new algosdk.Algodv2(
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
        Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443'),
      );
      const suggestedParams = await algod.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0,
        note: new TextEncoder().encode(nonce),
        suggestedParams,
      });
      const signedArr = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      const signed = signedArr[0];
      if (!signed) throw new Error('Wallet declined to sign.');
      setStatus('verifying');
      const signature = Buffer.from(signed).toString('base64');
      const loggedIn = await walletLogin(activeAddress, nonce, signature);
      await refresh();
      setStatus('idle');
      return true;
    } catch (err: any) {
      setError(
        err?.isServiceDown
          ? err.message
          : (err?.response?.data?.message ?? err?.message ?? 'Wallet sign-in failed.'),
      );
      setStatus('error');
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [activeAddress, signTransactions, refresh]);

  // Auto sign-in: wallet connected, no session yet.
  useEffect(() => {
    if (options.auto && activeAddress && !user && status === 'idle') {
      void signIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.auto, activeAddress, signTransactions, user]);

  return { status, error, signIn };
}
