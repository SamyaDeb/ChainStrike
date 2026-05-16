'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@txnlab/use-wallet-react';
import { register, login } from '@/lib/auth';

const INPUT = 'w-full px-3 py-2 bg-[#0F1117] border border-[#2A2D3A] text-white rounded-lg text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const LABEL = 'block text-sm font-medium text-gray-300 mb-1';

export default function RegisterPage() {
  const router = useRouter();
  const { wallets, activeAddress, activeWallet } = useWallet();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [walletError, setWalletError] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const shortAddr = activeAddress
    ? `${activeAddress.slice(0, 6)}…${activeAddress.slice(-4)}`
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setWalletError(false);

    if (!activeAddress) {
      setWalletError(true);
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, activeAddress);
      await login(email, password);
      router.push('/kyc');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? '';
      setError(msg.toLowerCase().includes('already') ? 'Email already registered.' : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Chain<span className="text-blue-500">Strike</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Create your investor account</p>
        </div>

        <div className="bg-[#1A1D27] border border-[#2A2D3A] rounded-2xl overflow-hidden">
          <div className="p-8 space-y-6">

            {/* ── Step 1: Connect Wallet (mandatory) ───────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${activeAddress ? 'bg-green-600 text-white' : 'bg-[#2A2D3A] text-gray-400'}`}>
                  {activeAddress ? '✓' : '1'}
                </div>
                <span className="text-sm font-semibold text-white">Connect Algorand Wallet</span>
                <span className="text-red-500 text-xs">*</span>
              </div>

              {!activeAddress ? (
                <div className="space-y-2">
                  {walletError && (
                    <p className="text-xs text-red-400 mb-2">Connect a wallet to continue — it will be linked to your account.</p>
                  )}
                  {wallets?.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => { wallet.connect(); setWalletError(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 bg-[#0F1117] border rounded-lg text-white text-sm font-medium transition-colors ${
                        walletError ? 'border-red-500/60 hover:border-red-400' : 'border-[#2A2D3A] hover:border-blue-500/50'
                      }`}
                    >
                      {wallet.metadata.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={wallet.metadata.icon} alt="" className="w-6 h-6 rounded flex-shrink-0" />
                      )}
                      Connect {wallet.metadata.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-800/40 rounded-lg">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                  <span className="text-xs font-mono text-green-400 truncate flex-1">{shortAddr}</span>
                  <button
                    type="button"
                    onClick={() => activeWallet?.disconnect()}
                    className="text-xs text-gray-500 hover:text-white transition-colors flex-shrink-0"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            {/* ── Step 2: Account Details ───────────────────────────── */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-[#2A2D3A] text-gray-400">
                  2
                </div>
                <span className="text-sm font-semibold text-white">Account Details</span>
              </div>

              <div>
                <label className={LABEL}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT}
                  placeholder="you@example.com"
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
                  placeholder="Minimum 12 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={LABEL}>Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={`${INPUT} ${confirm && confirm !== password ? 'border-red-500/60' : ''}`}
                  placeholder="Re-enter password"
                  required
                  autoComplete="new-password"
                />
                {confirm && confirm !== password && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match.</p>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !activeAddress}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>

              {!activeAddress && (
                <p className="text-xs text-amber-500/80 text-center">Connect a wallet above to enable registration.</p>
              )}
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-5 bg-[#0F1117] border-t border-[#2A2D3A] text-center">
            <p className="text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
