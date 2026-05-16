'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import algosdk from 'algosdk';
import { api } from '@/lib/api';
import { useWallet } from '@/providers/wallet-provider';

const CATEGORIES = [
  { value: 'PRECIOUS_METALS', label: 'Precious Metals' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'PRIVATE_DEBT', label: 'Private Debt' },
  { value: 'CORPORATE_BOND', label: 'Corporate Bond' },
  { value: 'COMMODITY', label: 'Commodity' },
  { value: 'PRIVATE_EQUITY', label: 'Private Equity' },
];

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';
const HINT = 'text-xs text-gray-400 mt-1';

type SubmitStage =
  | 'idle'
  | 'fetching-params'
  | 'awaiting-wallet-liquidity'
  | 'confirming-liquidity'
  | 'submitting-form'
  | 'done';

const STAGE_LABEL: Record<SubmitStage, string> = {
  idle: 'Submit & Deposit →',
  'fetching-params': 'Preparing on-chain transaction…',
  'awaiting-wallet-liquidity': 'Confirm liquidity deposit in Pera Wallet…',
  'confirming-liquidity': 'Waiting for confirmation on Algorand…',
  'submitting-form': 'Submitting application…',
  done: 'Done!',
};

async function buildSignAndBroadcastUsdcTransfer(
  algodClient: algosdk.Algodv2,
  senderAddress: string,
  receiverAddress: string,
  usdcAsaId: number,
  microUsdc: bigint,
  signer: (txns: Uint8Array[], indices: number[]) => Promise<Uint8Array[]>,
): Promise<string> {
  const [suggestedParams, accountInfo] = await Promise.all([
    algodClient.getTransactionParams().do(),
    algodClient.accountInformation(senderAddress).do(),
  ]);

  const isOptedIn = (accountInfo.assets ?? []).some(
    (a: { assetId: bigint }) => a.assetId === BigInt(usdcAsaId),
  );

  const depositTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: senderAddress,
    receiver: receiverAddress,
    assetIndex: usdcAsaId,
    amount: microUsdc,
    note: new TextEncoder().encode('ChainStrike — token launch deposit'),
    suggestedParams,
  });

  if (!isOptedIn) {
    // Prepend a 0-amount self-transfer (opt-in) atomically with the deposit
    const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: senderAddress,
      receiver: senderAddress,
      assetIndex: usdcAsaId,
      amount: 0,
      note: new TextEncoder().encode('ChainStrike — USDC opt-in'),
      suggestedParams,
    });

    algosdk.assignGroupID([optInTxn, depositTxn]);

    const [signedOptIn, signedDeposit] = await signer(
      [algosdk.encodeUnsignedTransaction(optInTxn), algosdk.encodeUnsignedTransaction(depositTxn)],
      [0, 1],
    );

    const { txid } = await algodClient.sendRawTransaction([signedOptIn, signedDeposit]).do();
    await algosdk.waitForConfirmation(algodClient, txid, 4);
    return txid;
  }

  const encodedTxn = algosdk.encodeUnsignedTransaction(depositTxn);
  const [signedBytes] = await signer([encodedTxn], [0]);

  const { txid } = await algodClient.sendRawTransaction(signedBytes).do();
  await algosdk.waitForConfirmation(algodClient, txid, 4);
  return txid;
}

export default function NewAssetPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { walletAddress, connect, signer } = useWallet();

  const [form, setForm] = useState({
    name: '',
    ticker: '',
    category: 'PRECIOUS_METALS',
    description: '',
    totalSupply: '',
    decimals: '6',
    pricePerToken: '',
    lockupDays: '0',
    minimumKycTier: '1',
    liquidityDepositUsdc: '',
    tokenizationRatio: '',
    spvEntityName: '',
    custodianName: '',
    custodianJurisdiction: '',
  });

  const [stage, setStage] = useState<SubmitStage>('idle');
  const [txError, setTxError] = useState('');

  const liquidityAmount = parseFloat(form.liquidityDepositUsdc) || 0;
  const pricePerTokenNum = parseFloat(form.pricePerToken) || 0;
  const estimatedTokens = pricePerTokenNum > 0 ? Math.floor(liquidityAmount / pricePerTokenNum) : 0;

  const mutation = useMutation({
    mutationFn: async (payload: typeof form & {
      initialLiquidityTxId: string;
      liquidityDepositTxId?: string;
      issuerWalletAddress: string;
    }) => {
      const { data } = await api.post('/assets', {
        name: payload.name,
        ticker: payload.ticker,
        category: payload.category,
        description: payload.description,
        totalSupply: BigInt(Math.floor(parseFloat(payload.totalSupply) * 1_000_000)).toString(),
        decimals: parseInt(payload.decimals),
        pricePerToken: BigInt(Math.floor(parseFloat(payload.pricePerToken) * 1_000_000)).toString(),
        lockupDays: parseInt(payload.lockupDays),
        minimumKycTier: parseInt(payload.minimumKycTier),
        tokenizationRatio: payload.tokenizationRatio,
        spvEntityName: payload.spvEntityName,
        custodianName: payload.custodianName,
        custodianJurisdiction: payload.custodianJurisdiction,
        initialLiquidityTxId: payload.initialLiquidityTxId,
        liquidityDepositTxId: payload.liquidityDepositTxId,
        liquidityDepositUsdc: payload.liquidityDepositUsdc
          ? BigInt(Math.floor(parseFloat(payload.liquidityDepositUsdc) * 1_000_000)).toString()
          : undefined,
        issuerWalletAddress: payload.issuerWalletAddress,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-assets'] });
      setStage('done');
      router.push('/dashboard');
    },
    onError: () => setStage('idle'),
  });

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTxError('');

    if (!walletAddress || !signer) {
      setTxError('Connect your Pera Wallet — the launch deposit requires a wallet signature.');
      return;
    }
    if (!form.liquidityDepositUsdc || liquidityAmount <= 0) {
      setTxError('Enter a liquidity deposit amount — this determines your initial token allocation.');
      return;
    }

    const issuanceEscrowAddress = process.env.NEXT_PUBLIC_ISSUANCE_ESCROW_ADDRESS ?? '';
    if (!issuanceEscrowAddress) {
      setTxError('Issuance escrow address not configured. Contact ChainStrike support.');
      return;
    }

    try {
      setStage('fetching-params');
      const usdcAsaId = parseInt(process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941');
      const algodServer = process.env.NEXT_PUBLIC_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
      const algodPort = parseInt(process.env.NEXT_PUBLIC_ALGOD_PORT ?? '443');
      const algodClient = new algosdk.Algodv2('', algodServer, algodPort);

      // Liquidity deposit — USDC goes to IssuanceLiquidityEscrow contract (on-chain hold)
      // Released to vault on approval, or returned to issuer on rejection
      setStage('awaiting-wallet-liquidity');
      const liquidityTxId = await buildSignAndBroadcastUsdcTransfer(
        algodClient,
        walletAddress,
        issuanceEscrowAddress,
        usdcAsaId,
        BigInt(Math.floor(liquidityAmount * 1_000_000)),
        signer,
      );
      setStage('confirming-liquidity');

      setStage('submitting-form');
      mutation.mutate({
        ...form,
        initialLiquidityTxId: liquidityTxId,
        liquidityDepositTxId: liquidityTxId,
        issuerWalletAddress: walletAddress,
      });
    } catch (err: any) {
      setTxError(err?.message ?? 'Transaction cancelled or failed. Please try again.');
      setStage('idle');
    }
  }

  const isPending = stage !== 'idle' && stage !== 'done';
  const isConfirming = stage === 'confirming-liquidity';

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tokenize a Real-World Asset</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit your application and deposit liquidity from your wallet to launch the token.
        </p>
      </div>

      {/* Wallet status */}
      {!walletAddress ? (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">Wallet required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Connect your Pera Wallet to sign the on-chain launch deposit when you submit.
            </p>
            <button
              type="button"
              onClick={() => connect().catch(() => {})}
              className="mt-2 text-xs font-medium text-amber-800 underline hover:no-underline"
            >
              Connect Pera Wallet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg text-xs">
          <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
          <span className="text-green-800 font-medium">Wallet connected:</span>
          <span className="font-mono text-green-700 truncate">{walletAddress}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">

        {/* ── Token Identity ──────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Token Identity</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Asset Name</label>
                <input value={form.name} onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Gold Bullion Fund" className={INPUT} required />
              </div>
              <div>
                <label className={LABEL}>Ticker Symbol</label>
                <input value={form.ticker} onChange={(e) => handleChange('ticker', e.target.value.toUpperCase())}
                  placeholder="GLDX" maxLength={8} className={INPUT + ' uppercase'} required />
              </div>
            </div>

            <div>
              <label className={LABEL}>Category</label>
              <select value={form.category} onChange={(e) => handleChange('category', e.target.value)} className={INPUT}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className={LABEL}>Description</label>
              <textarea value={form.description} onChange={(e) => handleChange('description', e.target.value)}
                rows={3} placeholder="Describe the underlying asset, valuation methodology, and key terms…"
                className={INPUT + ' resize-none'} required minLength={20} />
            </div>

            <div>
              <label className={LABEL}>Tokenization Ratio</label>
              <input value={form.tokenizationRatio} onChange={(e) => handleChange('tokenizationRatio', e.target.value)}
                placeholder="1 GLDX = 1 gram of 999.9 fine gold" className={INPUT} required />
              <p className={HINT}>Legal backing statement: what 1 token represents.</p>
            </div>
          </div>
        </div>

        {/* ── Token Economics ─────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Token Economics</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Total Supply (tokens)</label>
                <input type="number" value={form.totalSupply} onChange={(e) => handleChange('totalSupply', e.target.value)}
                  placeholder="1000000" className={INPUT} required min="1" />
              </div>
              <div>
                <label className={LABEL}>Price per Token (USDC)</label>
                <input type="number" value={form.pricePerToken} onChange={(e) => handleChange('pricePerToken', e.target.value)}
                  placeholder="10.00" step="0.000001" className={INPUT} required min="0.000001" />
              </div>
            </div>

            {/* ── Liquidity Deposit ─────────────────────────────── */}
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div>
                <label className="block text-sm font-semibold text-emerald-900 mb-1">
                  Liquidity Deposit (USDC)
                  <span className="ml-1 text-red-500">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={form.liquidityDepositUsdc}
                    onChange={(e) => handleChange('liquidityDepositUsdc', e.target.value)}
                    placeholder="e.g. 5000"
                    className="flex-1 px-3 py-2 border-2 border-emerald-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    min="0"
                    step="0.01"
                    required
                  />
                  <span className="text-sm font-medium text-emerald-700 flex-shrink-0">USDC</span>
                </div>

                {liquidityAmount > 0 && estimatedTokens > 0 && (
                  <p className="text-xs text-emerald-700 mt-1.5 font-medium">
                    You will receive ~{estimatedTokens.toLocaleString()} tokens at listing price
                    ({form.pricePerToken} USDC/token).
                    Remaining {((parseFloat(form.totalSupply) || 0) - estimatedTokens).toLocaleString()} tokens stay locked in the vault.
                  </p>
                )}
                {liquidityAmount > 0 && estimatedTokens === 0 && pricePerTokenNum === 0 && (
                  <p className="text-xs text-amber-600 mt-1.5">Enter token price above to see your allocation preview.</p>
                )}
              </div>

              <div className="text-xs text-emerald-800 space-y-1 border-t border-emerald-200 pt-3">
                <p><strong>How this works (fully on-chain, Algorand testnet):</strong></p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Your USDC is sent directly to the <strong>IssuanceLiquidityEscrow</strong> smart contract — not the treasury.</li>
                  <li>The escrow contract holds your USDC until admin makes a final decision.</li>
                  <li><strong>Approved:</strong> USDC is released via inner transaction from escrow → TokenVault as on-chain collateral.</li>
                  <li><strong>Rejected:</strong> USDC is returned via inner transaction from escrow → your wallet automatically.</li>
                  <li>On approval, the vault sends you tokens proportional to your deposit ÷ listing price.</li>
                  <li>Your tokens are placed as SELL orders — investors can buy immediately on market open.</li>
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Lockup Period (days)</label>
                <input type="number" value={form.lockupDays} onChange={(e) => handleChange('lockupDays', e.target.value)}
                  placeholder="0" className={INPUT} min="0" />
                <p className={HINT}>0 = immediate secondary trading</p>
              </div>
              <div>
                <label className={LABEL}>Minimum KYC Tier</label>
                <select value={form.minimumKycTier} onChange={(e) => handleChange('minimumKycTier', e.target.value)} className={INPUT}>
                  <option value="1">Tier 1 — Retail (≤ $12K/yr)</option>
                  <option value="2">Tier 2 — Accredited (≤ $600K/yr)</option>
                  <option value="3">Tier 3 — Institutional</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ── Ownership & Custody ─────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Ownership & Custody</h2>
          <p className="text-xs text-gray-500 mb-4">
            Committed on-chain when your ASA is deployed after admin approval.
          </p>
          <div className="space-y-4">
            <div>
              <label className={LABEL}>SPV Entity Name</label>
              <input value={form.spvEntityName} onChange={(e) => handleChange('spvEntityName', e.target.value)}
                placeholder="Gold Holdings SPV I Pte Ltd" className={INPUT} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Custodian Name</label>
                <input value={form.custodianName} onChange={(e) => handleChange('custodianName', e.target.value)}
                  placeholder="Brinks Singapore Pte Ltd" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Custodian Jurisdiction</label>
                <input value={form.custodianJurisdiction} onChange={(e) => handleChange('custodianJurisdiction', e.target.value.toUpperCase())}
                  placeholder="SG" maxLength={3} className={INPUT + ' uppercase'} />
                <p className={HINT}>ISO 3166 (e.g. SG, US, GB)</p>
              </div>
            </div>
          </div>
        </div>

        {/* After submission notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <strong>After submission:</strong> Upload ownership proof documents (vault receipts, legal opinions,
          valuation reports). SHA-256 hashes are stored immutably in your ASA on Algorand.
        </div>

        {/* Error display */}
        {(txError || mutation.isError) && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">
              {txError ||
                ((mutation.error as any)?.response?.data?.message ??
                  (mutation.error as Error)?.message ??
                  'Failed to submit. Please try again.')}
            </p>
          </div>
        )}

        {/* Progress indicator */}
        {isPending && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-sm text-blue-800 font-medium">{STAGE_LABEL[stage]}</span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isPending}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || liquidityAmount <= 0}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isPending && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {STAGE_LABEL[isPending ? stage : 'idle']}
          </button>
        </div>
      </form>
    </div>
  );
}
