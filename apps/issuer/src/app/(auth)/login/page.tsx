'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login, walletChallenge, walletLogin } from '@/lib/auth';
import { useWallet } from '@/providers/wallet-provider';

type Tab = 'email' | 'wallet';

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';

export default function LoginPage() {
  const router = useRouter();
  const { walletAddress, connect, signChallenge } = useWallet();

  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      if (err?.code === 'ADMIN_ROLE') {
        setError('ADMIN_ROLE');
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectWallet() {
    setError('');
    try {
      await connect();
    } catch {
      setError('Could not connect wallet. Please try again.');
    }
  }

  async function handleWalletLogin() {
    if (!walletAddress) return;
    setLoading(true);
    setError('');
    try {
      const { nonce } = await walletChallenge(walletAddress);
      const signature = await signChallenge(nonce);
      await walletLogin(walletAddress, nonce, signature);
      router.push('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Wallet login failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">ChainStrike</h1>
          <p className="text-sm text-gray-500 mt-1">Tokenize real-world assets on Algorand</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => { setTab('email'); setError(''); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === 'email'
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Email & Password
            </button>
            <button
              onClick={() => { setTab('wallet'); setError(''); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === 'wallet'
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Connect Wallet
            </button>
          </div>

          <div className="p-8">
            {/* ── Email / Password Tab ─────────────────────────────── */}
            {tab === 'email' && (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label className={LABEL}>Email</label>
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
                    className={INPUT}
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                  />
                </div>

                {error === 'ADMIN_ROLE' ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                    <p className="font-medium">Admin account detected</p>
                    <p className="mt-0.5">
                      This is the issuer portal. Admin accounts must sign in at the{' '}
                      <a
                        href="http://localhost:3100/login"
                        className="font-semibold underline hover:no-underline"
                      >
                        Admin Portal →
                      </a>
                    </p>
                  </div>
                ) : error ? (
                  <p className="text-sm text-red-600">{error}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {/* ── Wallet Tab ───────────────────────────────────────── */}
            {tab === 'wallet' && (
              <div className="space-y-5">
                <p className="text-sm text-gray-600 text-center">
                  Sign in by connecting your Pera Wallet. Your wallet must already be linked to a ChainStrike account.
                </p>

                {!walletAddress ? (
                  <button
                    onClick={handleConnectWallet}
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Connect Pera Wallet
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                      <span className="text-xs font-mono text-green-800 truncate">{walletAddress}</span>
                    </div>
                    <button
                      onClick={handleWalletLogin}
                      disabled={loading}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Signing challenge…' : 'Sign in with Wallet'}
                    </button>
                  </div>
                )}

                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
              </div>
            )}
          </div>

          {/* Create account footer */}
          <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-blue-600 hover:text-blue-700 font-medium">
                Create issuer account
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
