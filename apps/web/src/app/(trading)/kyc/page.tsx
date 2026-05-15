'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@txnlab/use-wallet-react';

export default function KycPage() {
  const { activeAddress, signBytes } = useWallet();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  // Get KYC status
  const { data: kycStatus } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: async () => {
      const { data } = await api.get('/kyc/status');
      return data as {
        status: string;
        tier?: number;
        expiresAt?: string;
        sdkToken?: string;
      };
    },
  });

  // Initiate KYC
  const initiateKyc = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/kyc/initiate', {});
      return data as { sdkToken: string; applicantId: string };
    },
  });

  // Connect wallet
  const connectWallet = useMutation({
    mutationFn: async () => {
      if (!activeAddress) throw new Error('No wallet connected');

      // Get challenge from backend
      const { data: challengeData } = await api.post('/wallets/challenge', { walletAddress: activeAddress });
      setChallengeToken(challengeData.challenge);

      // Sign challenge with wallet
      const encoded = new TextEncoder().encode(challengeData.challenge);
      const signed = await signBytes(encoded, activeAddress);

      // Verify signature on backend
      await api.post('/wallets/connect', {
        walletAddress: activeAddress,
        challenge: challengeData.challenge,
        signature: Buffer.from(signed).toString('base64'),
      });
    },
  });

  const tier = kycStatus?.tier ?? 0;
  const tierLabels = ['Not Started', 'Tier 1 ($12K/yr)', 'Tier 2 ($600K/yr)', 'Tier 3 (Unlimited)'];

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">KYC Verification</h1>
        <p className="text-sm text-gray-400 mt-1">Complete identity verification to start trading on ChainStrike</p>
      </div>

      {/* KYC status card */}
      <div className="bg-[#1A1D27] border border-[#2A2D3A] rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-3 h-3 rounded-full ${tier > 0 ? 'bg-green-500' : 'bg-gray-500'}`} />
          <span className="text-sm font-medium text-white">
            {kycStatus?.status === 'APPROVED' ? tierLabels[tier] : (kycStatus?.status ?? 'Not verified')}
          </span>
        </div>

        {kycStatus?.expiresAt && (
          <p className="text-xs text-gray-500">
            Expires: {new Date(kycStatus.expiresAt).toLocaleDateString()}
          </p>
        )}

        {/* Tier breakdown */}
        <div className="mt-4 space-y-2">
          {[
            { t: 1, label: 'Tier 1', limit: '$12,000 / year', requirement: 'Government ID + selfie' },
            { t: 2, label: 'Tier 2', limit: '$600,000 / year', requirement: 'Enhanced due diligence' },
            { t: 3, label: 'Tier 3', limit: 'Unlimited', requirement: 'Accredited investor status' },
          ].map(({ t, label, limit, requirement }) => (
            <div
              key={t}
              className={`flex items-start gap-3 p-3 rounded-lg ${tier >= t ? 'bg-green-900/20 border border-green-800/30' : 'bg-[#0F1117] border border-[#2A2D3A]'}`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${tier >= t ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                {t}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{label}</span>
                  <span className="text-xs text-gray-400">{limit}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{requirement}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        {(!kycStatus || kycStatus.status !== 'APPROVED') && (
          <button
            onClick={() => initiateKyc.mutate()}
            disabled={initiateKyc.isPending}
            className="mt-5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {initiateKyc.isPending ? 'Loading…' : 'Start Verification'}
          </button>
        )}
      </div>

      {/* Wallet connection */}
      <div className="bg-[#1A1D27] border border-[#2A2D3A] rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Algorand Wallet</h2>
        <p className="text-xs text-gray-400">
          Connect your Algorand wallet to enable on-chain settlement. You must sign a challenge to prove ownership.
        </p>

        {!activeAddress ? (
          <p className="text-xs text-yellow-500">Connect your wallet via the top navigation bar first.</p>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-gray-300">{activeAddress}</span>
            <button
              onClick={() => connectWallet.mutate()}
              disabled={connectWallet.isPending || connectWallet.isSuccess}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {connectWallet.isSuccess ? '✓ Connected' : connectWallet.isPending ? 'Signing…' : 'Verify Ownership'}
            </button>
          </div>
        )}

        {connectWallet.isError && (
          <p className="text-xs text-red-500">{(connectWallet.error as Error).message}</p>
        )}
      </div>
    </div>
  );
}
