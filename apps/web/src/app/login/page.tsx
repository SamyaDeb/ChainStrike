'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { login, walletChallenge, walletLogin } from '@/lib/auth';

type Tab = 'email' | 'wallet';

const INPUT = 'w-full px-3 py-2 bg-[#0F1117] border border-[#2A2D3A] text-white rounded-lg text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const LABEL = 'block text-sm font-medium text-gray-300 mb-1';

export default function LoginPage() {
  const router = useRouter();
  const { wallets, activeAddress, signTransactions, activeWallet } = useWallet();

  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletStep, setWalletStep] = useState<'idle' | 'signing' | 'verifying'>('idle');

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.push('/markets');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleWalletLogin() {
    if (!activeAddress || !signTransactions) return;
    setLoading(true);
    setError('');
    setWalletStep('signing');
    try {
      // Step 1: get nonce from backend
      const { nonce } = await walletChallenge(activeAddress);

      // Step 2: build a 0-ALGO self-payment with nonce as note — no ALGO leaves the wallet
      const algodClient = new algosdk.Algodv2(
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
        Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443'),
      );
      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0,
        note: new TextEncoder().encode(nonce),
        suggestedParams,
      });

      // Step 3: sign in wallet (Pera/Defly shows this as 0-ALGO self-send)
      const signedArr = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      const signed = signedArr[0];
      if (!signed) throw new Error('Wallet declined to sign. Please approve the signing request.');

      setWalletStep('verifying');

      // Step 4: verify signature + issue JWT (auto-registers if first time)
      const signature = Buffer.from(signed).toString('base64');
      await walletLogin(activeAddress, nonce, signature);
      router.push('/markets');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Wallet sign-in failed.';
      setError(msg);
    } finally {
      setLoading(false);
      setWalletStep('idle');
    }
  }

  const shortAddr = activeAddress
    ? `${activeAddress.slice(0, 6)}…${activeAddress.slice(-4)}`
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Chain<span className="text-blue-500">Strike</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">RWA Exchange on Algorand</p>
        </div>

        <div className="bg-[#1A1D27] border border-[#2A2D3A] rounded-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[#2A2D3A]">
            {(['email', 'wallet'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); }}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'email' ? 'Email & Password' : 'Connect Wallet'}
              </button>
            ))}
          </div>

          <div className="p-8">
            {/* ── Email / Password ─────────────────────────────────── */}
            {tab === 'email' && (
              <form onSubmit={handleEmailLogin} className="space-y-4">
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
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>

                <p className="text-xs text-gray-600 text-center pt-1">
                  Testnet: investor@testnet.io / Investor@Test2024!
                </p>
              </form>
            )}

            {/* ── Connect Wallet ───────────────────────────────────── */}
            {tab === 'wallet' && (
              <div className="space-y-5">
                <p className="text-sm text-gray-400 text-center">
                  Sign in by connecting your Algorand wallet. Your wallet must be linked to a ChainStrike account.
                </p>

                {!activeAddress ? (
                  <div className="space-y-2">
                    {wallets?.map((wallet) => (
                      <button
                        key={wallet.id}
                        onClick={() => wallet.connect()}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-[#0F1117] border border-[#2A2D3A] hover:border-blue-500/50 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
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
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-800/40 rounded-lg">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-green-400 font-medium">Wallet connected</p>
                        <p className="text-xs font-mono text-gray-400 truncate">{activeAddress}</p>
                      </div>
                      <button
                        onClick={() => activeWallet?.disconnect()}
                        className="text-xs text-gray-500 hover:text-white transition-colors flex-shrink-0"
                      >
                        Disconnect
                      </button>
                    </div>

                    <div className="text-xs text-gray-500 bg-[#0F1117] rounded-lg px-3 py-2">
                      Signing a <strong className="text-gray-300">0 ALGO</strong> message to prove wallet ownership. Nothing is sent on-chain.
                    </div>

                    <button
                      onClick={handleWalletLogin}
                      disabled={loading}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {walletStep === 'signing' && (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Waiting for wallet signature…
                        </>
                      )}
                      {walletStep === 'verifying' && (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Verifying…
                        </>
                      )}
                      {walletStep === 'idle' && 'Sign in with Wallet'}
                    </button>
                  </div>
                )}

                {error && (
                  <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-center">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-5 bg-[#0F1117] border-t border-[#2A2D3A] text-center">
            <p className="text-sm text-gray-500">
              New to ChainStrike?{' '}
              <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
