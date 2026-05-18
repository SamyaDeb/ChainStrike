'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

interface WhitelistEntry {
  asaId: number;
  assetId: string;
  isActive: boolean;
  onChainTxId?: string | null;
}

function Onboarding() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refresh } = useAuth();
  const { wallets, activeAddress, signTransactions } = useWallet();

  const intent = searchParams.get('intent') === 'issuer' ? 'issuer' : 'investor';
  const redirect = searchParams.get('redirect');
  const finishHref = useMemo(() => {
    if (redirect && redirect.startsWith('/')) return redirect;
    return intent === 'issuer' ? '/issue/new' : '/markets';
  }, [redirect, intent]);

  const [walletVerified, setWalletVerified] = useState(false);
  const [stepError, setStepError] = useState('');

  // Existing verified wallets (resume support)
  const { data: linkedWallets } = useQuery({
    queryKey: ['linked-wallets'],
    queryFn: async () => {
      const { data } = await api.get('/wallets');
      return data as Array<{ address: string; verifiedAt?: string | null }>;
    },
  });
  useEffect(() => {
    if (linkedWallets?.some((w) => w.verifiedAt)) setWalletVerified(true);
  }, [linkedWallets]);

  // KYC status (poll while not approved)
  const { data: kyc } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: async () => {
      const { data } = await api.get('/kyc/status');
      return data as { status: string; tier?: number; expiresAt?: string };
    },
    refetchInterval: (q) =>
      (q.state.data as { status?: string } | undefined)?.status === 'APPROVED' ? false : 5000,
  });
  const kycApproved = kyc?.status === 'APPROVED' && (kyc?.tier ?? 0) > 0;

  // On-chain identity entry (asaId === 0), poll once KYC approved + wallet verified
  const { data: whitelist } = useQuery({
    queryKey: ['identity-whitelist', activeAddress],
    enabled: !!activeAddress && kycApproved && walletVerified,
    queryFn: async () => {
      const { data } = await api.get(`/compliance/whitelist/${activeAddress}`);
      return data as WhitelistEntry[];
    },
    refetchInterval: (q) =>
      (q.state.data as WhitelistEntry[] | undefined)?.some((e) => e.asaId === 0) ? false : 5000,
  });
  const identityEntry = whitelist?.find((e) => e.asaId === 0);
  const onChainDone = !!identityEntry;

  const verifyWallet = useMutation({
    mutationFn: async () => {
      if (!activeAddress || !signTransactions) throw new Error('No wallet connected');
      const { data: ch } = await api.get('/wallets/challenge');
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
        note: new TextEncoder().encode(ch.challenge),
        suggestedParams,
      });
      const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed) throw new Error('Wallet declined to sign');
      await api.post('/wallets/connect', {
        address: activeAddress,
        challenge: ch.challenge,
        signedChallenge: Buffer.from(signed).toString('base64'),
        network: process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'testnet',
      });
    },
    onSuccess: () => setWalletVerified(true),
    onError: (e: any) =>
      setStepError(e?.response?.data?.message ?? e?.message ?? 'Wallet verification failed.'),
  });

  const initiateKyc = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/kyc/initiate', {});
      return data as { sdkToken: string; applicantId: string };
    },
    onError: (e: any) =>
      setStepError(e?.response?.data?.message ?? e?.message ?? 'Could not start KYC.'),
  });

  // Refresh auth context once KYC tier lands so guards/navbar update.
  useEffect(() => {
    if (kycApproved && (user?.kycTier ?? 0) === 0) void refresh();
  }, [kycApproved, user, refresh]);

  const steps = [
    { key: 'account', title: 'Create account', done: !!user },
    { key: 'wallet', title: 'Verify wallet ownership', done: walletVerified },
    { key: 'kyc', title: 'Complete KYC verification', done: kycApproved },
    { key: 'chain', title: 'Register profile on-chain', done: onChainDone },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="min-h-screen bg-[#0F1117] px-4 py-12">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold text-white">
          {intent === 'issuer' ? 'Issuer onboarding' : 'Investor onboarding'}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Finish these steps to {intent === 'issuer' ? 'launch a token' : 'start trading'}. Your
          KYC data stays off-chain; only your verification tier is recorded on-chain.
        </p>

        <div className="mt-8 space-y-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className="rounded-xl border border-[#2A2D3A] bg-[#1A1D27] p-5"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.done ? 'bg-green-600 text-white' : 'bg-[#2A2D3A] text-gray-400'
                  }`}
                >
                  {s.done ? '✓' : i + 1}
                </div>
                <span className="text-sm font-semibold text-white">{s.title}</span>
              </div>

              {/* Step 2: wallet */}
              {s.key === 'wallet' && !s.done && (
                <div className="mt-4 space-y-2">
                  {!activeAddress ? (
                    wallets?.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => w.connect()}
                        className="w-full rounded-lg border border-[#2A2D3A] bg-[#0F1117] px-4 py-2.5 text-sm font-medium text-white hover:border-blue-500/50"
                      >
                        Connect {w.metadata.name}
                      </button>
                    ))
                  ) : (
                    <button
                      onClick={() => { setStepError(''); verifyWallet.mutate(); }}
                      disabled={verifyWallet.isPending}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {verifyWallet.isPending ? 'Check your wallet…' : 'Sign to verify ownership'}
                    </button>
                  )}
                </div>
              )}

              {/* Step 3: KYC */}
              {s.key === 'kyc' && !s.done && walletVerified && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-gray-400">
                    Status: {kyc?.status ?? 'NOT_STARTED'}. Complete verification in the Sumsub
                    window; this page updates automatically.
                  </p>
                  <button
                    onClick={() => { setStepError(''); initiateKyc.mutate(); }}
                    disabled={initiateKyc.isPending || initiateKyc.isSuccess}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {initiateKyc.isSuccess
                      ? 'Verification in progress…'
                      : initiateKyc.isPending
                        ? 'Loading…'
                        : 'Start KYC verification'}
                  </button>
                </div>
              )}

              {/* Step 4: on-chain */}
              {s.key === 'chain' && (
                <div className="mt-3">
                  {onChainDone ? (
                    <p className="text-xs text-green-400">
                      Identity registered on-chain
                      {identityEntry?.onChainTxId
                        ? ` — tx ${identityEntry.onChainTxId.slice(0, 10)}…`
                        : ' (pending confirmation)'}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      Created automatically after KYC approval.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {stepError && <p className="mt-4 text-sm text-red-400">{stepError}</p>}

        <button
          disabled={!allDone}
          onClick={() => router.push(finishHref)}
          className="mt-8 w-full rounded-lg bg-white py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {allDone
            ? intent === 'issuer'
              ? 'Continue to launch a token'
              : 'Continue to markets'
            : 'Complete all steps to continue'}
        </button>
      </div>
    </div>
  );
}
