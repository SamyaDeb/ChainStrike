'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { login, register, walletChallenge, walletLogin, isAdmin } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

type Mode = 'login' | 'register';
type LoginTab = 'email' | 'wallet';

const INPUT =
  'w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5';

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallets, activeAddress, signTransactions, activeWallet } = useWallet();
  const { refresh } = useAuth();

  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'register' ? 'register' : 'login',
  );
  const [animating, setAnimating] = useState(false);
  const [tab, setTab] = useState<LoginTab>('email');

  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletStep, setWalletStep] = useState<'idle' | 'connecting' | 'signing' | 'verifying'>('idle');
  const pendingWalletSignIn = useRef(false);

  function getRedirectPath() {
    const r = searchParams.get('redirect');
    return r && r.startsWith('/') ? r : '/markets';
  }
  function getIntent() {
    return searchParams.get('intent') === 'issuer' ? 'issuer' : 'investor';
  }

  async function handoffToAdmin() {
    await refresh();
    router.push('/admin');
  }

  function switchMode(next: Mode) {
    if (animating || mode === next) return;
    setError('');
    setAnimating(true);
    setTimeout(() => {
      setMode(next);
      setAnimating(false);
    }, 220);
  }

  // Auto wallet sign-in after wallet connects on wallet tab
  useEffect(() => {
    if (pendingWalletSignIn.current && activeAddress && !!signTransactions && !loading) {
      pendingWalletSignIn.current = false;
      handleWalletLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress, signTransactions]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await login(email, password);
      await refresh();
      if (isAdmin(user)) {
        router.push('/admin');
        return;
      }
      router.push(getRedirectPath());
    } catch (err: any) {
      setError(
        err?.isServiceDown ? err.message : (err?.response?.data?.message ?? 'Invalid email or password.'),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleWalletLogin() {
    if (!activeAddress || !signTransactions) {
      setError('Wallet not ready. Connect your wallet first.');
      return;
    }
    setLoading(true);
    setError('');
    setWalletStep('signing');
    try {
      const { nonce } = await walletChallenge(activeAddress);
      const algod = new algosdk.Algodv2(
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
        process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
        Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443'),
      );
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0,
        note: new TextEncoder().encode(nonce),
        suggestedParams: sp,
      });
      const signedArr = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      const signed = signedArr[0];
      if (!signed) throw new Error('Wallet declined to sign.');
      setWalletStep('verifying');
      const user = await walletLogin(activeAddress, nonce, Buffer.from(signed).toString('base64'));
      if (isAdmin(user)) {
        handoffToAdmin();
        return;
      }
      await refresh();
      router.push(getRedirectPath());
    } catch (err: any) {
      const raw = err?.response?.data?.message ?? err?.message ?? '';
      setError(
        err?.isServiceDown ? err.message
          : raw.toLowerCase().includes('not found') || raw.toLowerCase().includes('no account')
            ? 'No account linked to this wallet. Please create an account first.'
            : raw || 'Wallet sign-in failed.',
      );
    } finally {
      setLoading(false);
      setWalletStep('idle');
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!activeAddress) {
      setError('Connect your Algorand wallet — both email and wallet are required to create an account.');
      return;
    }
    if (regPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (regPassword !== regConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await register(regEmail, regPassword, activeAddress, getIntent(), fullName || undefined);
      await login(regEmail, regPassword);
      await refresh();
      router.push(getRedirectPath());
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? '';
      setError(
        msg.toLowerCase().includes('already') ? 'An account with that email already exists.'
          : msg || 'Registration failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      {/* ── Left: Image panel ── */}
      <div className="relative hidden w-1/2 lg:block">
        <Image src="/login-bg.png" alt="ChainStrike" fill className="object-cover" priority />
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute left-7 top-7 z-10 flex items-center gap-2">
          <Image src="/logo.png" alt="ChainStrike" width={32} height={32} className="rounded-full" />
          <span className="text-lg font-semibold text-white tracking-tight">ChainStrike</span>
        </div>
        {/* mode label on image */}
        <div className="absolute bottom-10 left-8 z-10">
          <p className="text-white/80 text-sm font-medium">
            {mode === 'register' ? 'Join ChainStrike' : 'Welcome back'}
          </p>
          <p className="text-white text-2xl font-bold mt-1 leading-snug">
            {mode === 'register'
              ? 'Start trading\nreal-world assets.'
              : 'Trade tokenized\nreal-world assets.'}
          </p>
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="relative flex w-full flex-col items-center justify-center bg-white px-6 lg:w-1/2 overflow-y-auto py-8">
        <Link
          href="/"
          className="absolute right-6 top-6 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Link>

        {/* Animated form container */}
        <div
          className="w-full max-w-sm transition-all duration-220"
          style={{
            opacity: animating ? 0 : 1,
            transform: animating ? 'translateY(10px)' : 'translateY(0)',
            transition: 'opacity 220ms ease, transform 220ms ease',
          }}
        >
          {mode === 'login' ? (
            <LoginForm
              tab={tab}
              setTab={setTab}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              error={error}
              loading={loading}
              walletStep={walletStep}
              activeAddress={activeAddress}
              wallets={wallets}
              activeWallet={activeWallet}
              pendingWalletSignIn={pendingWalletSignIn}
              setWalletStep={setWalletStep}
              setLoading={setLoading}
              onEmailLogin={handleEmailLogin}
              onWalletLogin={handleWalletLogin}
              onSwitchMode={() => switchMode('register')}
            />
          ) : (
            <RegisterForm
              firstName={firstName} setFirstName={setFirstName}
              lastName={lastName} setLastName={setLastName}
              regEmail={regEmail} setRegEmail={setRegEmail}
              regPassword={regPassword} setRegPassword={setRegPassword}
              regConfirm={regConfirm} setRegConfirm={setRegConfirm}
              error={error}
              loading={loading}
              activeAddress={activeAddress}
              wallets={wallets}
              activeWallet={activeWallet}
              onSubmit={handleRegister}
              onSwitchMode={() => switchMode('login')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Login sub-form ─────────────────────────── */

function LoginForm({
  tab, setTab, email, setEmail, password, setPassword,
  error, loading, walletStep, activeAddress, wallets, activeWallet,
  pendingWalletSignIn, setWalletStep, setLoading,
  onEmailLogin, onWalletLogin, onSwitchMode,
}: any) {
  return (
    <>
      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-gray-500">
        New to ChainStrike?{' '}
        <button
          onClick={onSwitchMode}
          className="font-semibold text-gray-900 underline underline-offset-2 hover:text-black transition-colors"
        >
          Create an account
        </button>
      </p>

      {/* Tabs */}
      <div className="mt-7 flex gap-1 border-b border-gray-200">
        {(['email', 'wallet'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2.5 px-1 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'email' ? 'Email' : 'Wallet'}
          </button>
        ))}
      </div>

      {tab === 'email' ? (
        <form onSubmit={onEmailLogin} className="mt-6 space-y-4">
          <div>
            <label className={LABEL}>Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className={INPUT} placeholder="you@example.com" required autoComplete="email" />
          </div>
          <div>
            <label className={LABEL}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className={INPUT} placeholder="••••••••••••" required autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 transition-colors mt-1">
            {loading ? 'Signing in…' : 'Continue'}
          </button>
          <p className="text-center text-xs text-gray-400">
            Testnet: investor@testnet.io / Investor@Test2024!
          </p>
        </form>
      ) : (
        <WalletLoginPanel
          loading={loading} walletStep={walletStep} error={error}
          activeAddress={activeAddress} wallets={wallets} activeWallet={activeWallet}
          pendingWalletSignIn={pendingWalletSignIn}
          setWalletStep={setWalletStep} setLoading={setLoading}
          onWalletLogin={onWalletLogin}
        />
      )}
    </>
  );
}

/* ─────────────────────── Wallet login panel ─────────────────────── */

function WalletLoginPanel({
  loading, walletStep, error, activeAddress, wallets, activeWallet,
  pendingWalletSignIn, setWalletStep, setLoading, onWalletLogin,
}: any) {
  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-gray-500">
        Sign with your Algorand wallet. You must already have an account linked to this wallet.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <span className="h-4 w-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
          <p className="text-sm font-medium text-blue-700">
            {walletStep === 'connecting' && 'Connecting wallet…'}
            {walletStep === 'signing' && 'Approve signing request in your wallet…'}
            {walletStep === 'verifying' && 'Verifying signature…'}
            {walletStep === 'idle' && 'Signing in…'}
          </p>
        </div>
      )}
      {activeAddress && !loading && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-700">Connected</p>
              <p className="truncate font-mono text-xs text-gray-500">{activeAddress}</p>
            </div>
            <button onClick={() => activeWallet?.disconnect()}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
              Change
            </button>
          </div>
          <button onClick={onWalletLogin}
            className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black transition-colors">
            Sign in with Wallet
          </button>
        </div>
      )}
      {!activeAddress && !loading && (
        <div className="space-y-2">
          {wallets?.map((wallet: any) => (
            <button key={wallet.id}
              onClick={() => {
                pendingWalletSignIn.current = true;
                setWalletStep('connecting');
                setLoading(true);
                wallet.connect().catch((err: any) => {
                  pendingWalletSignIn.current = false;
                  setLoading(false);
                  setWalletStep('idle');
                  const msg = err?.data?.type === 'CONNECT_MODAL_CLOSED' ? '' : (err?.message ?? 'Wallet connection failed.');
                  if (msg) console.error(msg);
                });
              }}
              className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 hover:border-gray-900 hover:bg-gray-900 hover:text-white transition-colors"
            >
              {wallet.metadata.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.metadata.icon} alt="" className="h-5 w-5 rounded flex-shrink-0" />
              )}
              Connect {wallet.metadata.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Register sub-form ─────────────────────── */

function RegisterForm({
  firstName, setFirstName, lastName, setLastName,
  regEmail, setRegEmail, regPassword, setRegPassword,
  regConfirm, setRegConfirm,
  error, loading, activeAddress, wallets, activeWallet,
  onSubmit, onSwitchMode,
}: any) {
  const shortAddr = activeAddress ? `${activeAddress.slice(0, 6)}…${activeAddress.slice(-4)}` : null;

  return (
    <>
      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Create account</h1>
      <p className="mt-2 text-sm text-gray-500">
        Already have one?{' '}
        <button
          onClick={onSwitchMode}
          className="font-semibold text-gray-900 underline underline-offset-2 hover:text-black transition-colors"
        >
          Sign in
        </button>
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>First name</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className={INPUT} placeholder="Sam" required autoComplete="given-name" />
          </div>
          <div>
            <label className={LABEL}>Last name</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
              className={INPUT} placeholder="Deb" required autoComplete="family-name" />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className={LABEL}>Email address</label>
          <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)}
            className={INPUT} placeholder="you@example.com" required autoComplete="email" />
        </div>

        {/* Password */}
        <div>
          <label className={LABEL}>Password <span className="normal-case font-normal text-gray-400">(min 12 chars)</span></label>
          <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)}
            className={INPUT} placeholder="••••••••••••" required autoComplete="new-password" />
        </div>

        {/* Confirm */}
        <div>
          <label className={LABEL}>Confirm password</label>
          <input type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)}
            className={`${INPUT} ${regConfirm && regConfirm !== regPassword ? 'border-red-400' : ''}`}
            placeholder="Re-enter password" required autoComplete="new-password" />
          {regConfirm && regConfirm !== regPassword && (
            <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>

        {/* Wallet — required */}
        <div>
          <label className={LABEL}>
            Algorand wallet <span className="normal-case font-normal text-gray-400">(required)</span>
          </label>
          {activeAddress ? (
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="flex-1 font-mono text-xs text-green-800 truncate">{shortAddr}</span>
              <button type="button" onClick={() => activeWallet?.disconnect()}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {wallets?.map((wallet: any) => (
                <button key={wallet.id} type="button" onClick={() => wallet.connect()}
                  className="w-full flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 hover:border-gray-900 hover:bg-gray-900 hover:text-white transition-colors">
                  {wallet.metadata.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wallet.metadata.icon} alt="" className="w-5 h-5 rounded flex-shrink-0" />
                  )}
                  Connect {wallet.metadata.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">{error}</p>
        )}

        <button type="submit" disabled={loading}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 transition-colors">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-xs text-gray-400 text-center leading-relaxed">
        By continuing you agree to ChainStrike&apos;s{' '}
        <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
        {' '}and{' '}
        <Link href="/terms" className="underline hover:text-gray-600">Terms of Service</Link>.
      </p>
    </>
  );
}
