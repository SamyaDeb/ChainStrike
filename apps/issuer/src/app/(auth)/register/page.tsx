'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import { useWallet } from '@/providers/wallet-provider';

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const INPUT_ERR = 'w-full px-3 py-2 border border-red-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';
const HINT = 'text-xs text-gray-400 mt-1';

export default function RegisterPage() {
  const router = useRouter();
  const { walletAddress, connect, disconnect } = useWallet();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);

  async function handleConnectWallet() {
    setWalletError('');
    setConnectingWallet(true);
    try {
      await connect();
    } catch (err: any) {
      if (err?.data?.type !== 'CONNECT_MODAL_CLOSED') {
        setWalletError('Could not connect wallet. Please try again.');
      }
    } finally {
      setConnectingWallet(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setWalletError('');
    setSuccess('');

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // walletAddress is optional — users can link a wallet from the dashboard later
      await register(email, password, walletAddress ?? undefined);
      setSuccess('Account created! Redirecting to sign in…');
      setTimeout(() => router.push('/login'), 1500);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.message ?? 'Registration failed. Please try again.';
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">ChainStrike</h1>
          <p className="text-sm text-gray-500 mt-1">Create your issuer account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-8 space-y-5">

            {/* ── Email & Password ─────────────────────────────────── */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={LABEL}>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label className={LABEL}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={password && password.length < 12 ? INPUT_ERR : INPUT}
                  placeholder="At least 12 characters"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <p className={HINT}>Minimum 12 characters — include upper, lower, digit and symbol.</p>
              </div>

              <div>
                <label className={LABEL}>Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={confirm && confirm !== password ? INPUT_ERR : INPUT}
                  placeholder="Repeat password"
                  required
                  autoComplete="new-password"
                />
                {confirm && confirm !== password && (
                  <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
                )}
              </div>

              {/* ── Optional wallet link ─────────────────────────── */}
              <div className="border border-gray-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Algorand Wallet
                    <span className="ml-1.5 text-xs font-normal text-gray-400">(optional)</span>
                  </span>
                  {walletAddress && (
                    <button
                      type="button"
                      onClick={disconnect}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {walletAddress ? (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                    <span className="text-xs font-mono text-green-800 truncate">{walletAddress}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectWallet}
                    disabled={connectingWallet}
                    className="w-full py-2 px-4 rounded-lg text-sm border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {connectingWallet ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Opening Pera Wallet…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Connect Pera Wallet
                      </>
                    )}
                  </button>
                )}
                {walletError && <p className="text-xs text-red-600">{walletError}</p>}
                <p className={HINT}>
                  Link a wallet now for instant wallet sign-in, or add one later from your dashboard.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-sm text-green-700">{success}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? 'Creating account…' : 'Create issuer account'}
              </button>
            </form>
          </div>

          <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          ChainStrike RWA Exchange &mdash; Algorand blockchain
        </p>
      </div>
    </div>
  );
}
