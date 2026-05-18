'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from './new.module.css';

const MAX_LOGO_BYTES = 200 * 1024;

const ASSET_COLORS = [
  '#76b900', '#0b1c3a', '#6b4fe6', '#1f4d3a', '#c62828',
  '#e23b1f', '#0071c5', '#ff8a3d', '#8a6cf5', '#1f9b5e',
  '#b8860b', '#2196f3', '#9c27b0', '#e91e63', '#ff5722',
];

function getColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return ASSET_COLORS[h % ASSET_COLORS.length];
}

const CATEGORIES = [
  { value: 'PRECIOUS_METALS', label: 'Precious Metals' },
  { value: 'REAL_ESTATE',     label: 'Real Estate' },
  { value: 'PRIVATE_DEBT',    label: 'Private Debt' },
  { value: 'CORPORATE_BOND',  label: 'Corporate Bond' },
  { value: 'COMMODITY',       label: 'Commodity' },
  { value: 'PRIVATE_EQUITY',  label: 'Private Equity' },
];

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Precious Metals',
  REAL_ESTATE:     'Real Estate',
  PRIVATE_DEBT:    'Private Debt',
  CORPORATE_BOND:  'Corporate Bond',
  COMMODITY:       'Commodity',
  PRIVATE_EQUITY:  'Private Equity',
};

type SubmitStage =
  | 'idle'
  | 'fetching-params'
  | 'awaiting-wallet-liquidity'
  | 'confirming-liquidity'
  | 'submitting-form'
  | 'done';

const STAGE_LABEL: Record<SubmitStage, string> = {
  idle:                        'Submit & Deposit',
  'fetching-params':           'Preparing on-chain transaction…',
  'awaiting-wallet-liquidity': 'Confirm deposit in wallet…',
  'confirming-liquidity':      'Waiting for Algorand confirmation…',
  'submitting-form':           'Submitting application…',
  done:                        'Done!',
};

export default function NewAssetPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeAddress, signTransactions, wallets } = useWallet();

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [logoDragging, setLogoDragging] = useState(false);
  const [logoError, setLogoError] = useState('');

  const handleLogoFile = useCallback((file: File | undefined) => {
    setLogoError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('File must be an image (PNG, JPG, SVG, WebP).');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`Logo must be under 200 KB (this file is ${(file.size / 1024).toFixed(0)} KB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setLogoPreview(result);
      setForm((prev) => ({ ...prev, logoUrl: result }));
    };
    reader.readAsDataURL(file);
  }, []);

  const [form, setForm] = useState({
    name: '',
    ticker: '',
    category: 'PRECIOUS_METALS',
    description: '',
    decimals: '6',
    pricePerToken: '',
    lockupDays: '0',
    minimumKycTier: '1',
    liquidityDepositUsdc: '',
    tokenizationRatio: '',
    spvEntityName: '',
    custodianName: '',
    custodianJurisdiction: '',
    logoUrl: '',
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
        logoUrl: payload.logoUrl || undefined,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-assets'] });
      setStage('done');
      router.push('/issue');
    },
    onError: () => setStage('idle'),
  });

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTxError('');

    if (!activeAddress || !signTransactions) {
      setTxError('Connect your wallet — the launch deposit requires a wallet signature.');
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
      const algodServer = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
      const algodPort = parseInt(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
      const algodClient = new algosdk.Algodv2('', algodServer, algodPort);

      setStage('awaiting-wallet-liquidity');

      const [suggestedParams, accountInfo] = await Promise.all([
        algodClient.getTransactionParams().do(),
        algodClient.accountInformation(activeAddress).do(),
      ]);

      const microUsdc = BigInt(Math.floor(liquidityAmount * 1_000_000));
      const isOptedIn = (accountInfo.assets ?? []).some(
        (a: { assetId: bigint }) => a.assetId === BigInt(usdcAsaId),
      );

      const depositTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: issuanceEscrowAddress,
        assetIndex: usdcAsaId,
        amount: microUsdc,
        note: new TextEncoder().encode('ChainStrike — token launch deposit'),
        suggestedParams,
      });

      let liquidityTxId: string;

      if (!isOptedIn) {
        const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: activeAddress,
          receiver: activeAddress,
          assetIndex: usdcAsaId,
          amount: 0,
          note: new TextEncoder().encode('ChainStrike — USDC opt-in'),
          suggestedParams,
        });
        algosdk.assignGroupID([optInTxn, depositTxn]);
        const signedArr = await signTransactions([
          algosdk.encodeUnsignedTransaction(optInTxn),
          algosdk.encodeUnsignedTransaction(depositTxn),
        ]);
        const signed = signedArr.filter((s): s is Uint8Array => s !== null);
        setStage('confirming-liquidity');
        const { txid } = await algodClient.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algodClient, txid, 4);
        liquidityTxId = txid;
      } else {
        const signedArr = await signTransactions([algosdk.encodeUnsignedTransaction(depositTxn)]);
        const signed = signedArr[0];
        if (!signed) throw new Error('Wallet declined to sign. Please approve the signing request.');
        setStage('confirming-liquidity');
        const { txid } = await algodClient.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algodClient, txid, 4);
        liquidityTxId = txid;
      }

      setStage('submitting-form');
      mutation.mutate({
        ...form,
        initialLiquidityTxId: liquidityTxId,
        liquidityDepositTxId: liquidityTxId,
        issuerWalletAddress: activeAddress,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction cancelled or failed. Please try again.';
      setTxError(msg);
      setStage('idle');
    }
  }

  const isPending = stage !== 'idle' && stage !== 'done';
  const iconBg = form.ticker ? getColor(form.ticker) : '#1a1a1a';
  const iconLabel = (form.ticker || '??').slice(0, 2).toUpperCase();

  return (
    <div className={styles.page}>
      <div className={styles.main}>

        {/* ── Page header ── */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Tokenize an Asset</h1>
            <p className={styles.pageSub}>
              Submit your tokenization application and deposit initial liquidity to launch the token on ChainStrike.
            </p>
          </div>
          <Link href="/issue" className={styles.backBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back to My Issues
          </Link>
        </div>

        <div className={styles.layout}>

          {/* ══ LEFT — Form ══ */}
          <form onSubmit={handleSubmit} className={styles.form}>

            {/* ── 1. Token Identity ── */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Token Identity</h2>
                <p className={styles.sectionSub}>Basic information that will appear on the market listing.</p>
              </div>

              <div className={styles.fields}>
                {/* Logo */}
                <div className={styles.field}>
                  <label className={styles.label}>Token Logo</label>
                  <div className={styles.logoUploadRow}>
                    <div
                      className={styles.logoPreview}
                      style={!logoPreview ? { background: iconBg } : undefined}
                    >
                      {logoPreview
                        ? <img src={logoPreview} alt="preview" className={styles.logoPreviewImg} />
                        : iconLabel
                      }
                    </div>
                    <div
                      className={`${styles.logoDropZone} ${logoDragging ? styles.logoDropZoneActive : ''}`}
                      onClick={() => logoInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setLogoDragging(true); }}
                      onDragLeave={() => setLogoDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setLogoDragging(false); handleLogoFile(e.dataTransfer.files[0]); }}
                    >
                      <svg className={styles.logoDropIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span className={styles.logoDropLabel}>{logoPreview ? 'Replace logo' : 'Upload logo'}</span>
                      <span className={styles.logoDropSub}>PNG, JPG, SVG, WebP · max 200 KB</span>
                      {logoPreview && (
                        <button type="button" className={styles.logoClearBtn}
                          onClick={(e) => { e.stopPropagation(); setLogoPreview(''); setForm((p) => ({ ...p, logoUrl: '' })); if (logoInputRef.current) logoInputRef.current.value = ''; }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => handleLogoFile(e.target.files?.[0])} />
                  </div>
                  {logoError && <p className={styles.hint} style={{ color: '#c93f3f' }}>{logoError}</p>}
                  <p className={styles.hint}>Square images work best. Shown on market cards and your dashboard.</p>
                </div>

                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Asset Name</label>
                    <input value={form.name} onChange={(e) => handleChange('name', e.target.value)}
                      placeholder="Gold Bullion Fund" className={styles.input} required />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Ticker Symbol</label>
                    <input value={form.ticker} onChange={(e) => handleChange('ticker', e.target.value.toUpperCase())}
                      placeholder="GLDX" maxLength={8} className={`${styles.input} ${styles.inputUpper}`} required />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Category</label>
                  <select value={form.category} onChange={(e) => handleChange('category', e.target.value)}
                    className={`${styles.input} ${styles.select}`}>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Description</label>
                  <textarea value={form.description} onChange={(e) => handleChange('description', e.target.value)}
                    rows={4} placeholder="Describe the underlying asset, valuation methodology, and key terms…"
                    className={`${styles.input} ${styles.textarea}`} required minLength={20} />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Tokenization Ratio</label>
                  <input value={form.tokenizationRatio} onChange={(e) => handleChange('tokenizationRatio', e.target.value)}
                    placeholder="1 GLDX = 1 gram of 999.9 fine gold" className={styles.input} required />
                  <p className={styles.hint}>Legal backing statement — what 1 token represents.</p>
                </div>
              </div>
            </div>

            <hr className={styles.divider} />

            {/* ── 2. Token Economics ── */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Token Economics</h2>
                <p className={styles.sectionSub}>Define supply, pricing, and your initial liquidity deposit.</p>
              </div>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label className={styles.label}>Price per Token (USDC)</label>
                  <input type="number" value={form.pricePerToken} onChange={(e) => handleChange('pricePerToken', e.target.value)}
                    placeholder="10.00" step="0.000001" className={styles.input} required min="0.000001" />
                  <p className={styles.hint}>Listing price in USDC. Token supply is automatically set to: liquidity ÷ price.</p>
                </div>

                {/* Liquidity deposit */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Liquidity Deposit<span className={styles.required}>*</span>
                  </label>
                  <div className={styles.liquidityBlock}>
                    <div className={styles.liquidityInputRow}>
                      <input type="number" value={form.liquidityDepositUsdc}
                        onChange={(e) => handleChange('liquidityDepositUsdc', e.target.value)}
                        placeholder="e.g. 5 000" className={styles.input} min="0" step="0.01" required />
                      <span className={styles.liquidityCurrency}>USDC</span>
                    </div>

                    {liquidityAmount > 0 && estimatedTokens > 0 && (
                      <div className={styles.liquidityEstimate}>
                        <svg className={styles.liquidityEstimateIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>
                          ~{estimatedTokens.toLocaleString()} tokens will be minted and seeded into the Tinyman V2 pool at {form.pricePerToken} USDC/token.
                        </span>
                      </div>
                    )}

                    <div className={styles.liquidityInfoBlock}>
                      <p className={styles.liquidityInfoTitle}>How this works</p>
                      {[
                        'Your USDC is sent to the IssuanceLiquidityEscrow contract — not the treasury.',
                        'Approved: USDC released to TokenVault as on-chain collateral.',
                        'Rejected: USDC returned to your wallet automatically.',
                        'On approval, you receive tokens proportional to deposit ÷ listing price.',
                      ].map((line, i) => (
                        <div key={i} className={styles.liquidityInfoRow}>
                          <span className={styles.liquidityInfoDot} />
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Lockup Period (days)</label>
                    <input type="number" value={form.lockupDays} onChange={(e) => handleChange('lockupDays', e.target.value)}
                      placeholder="0" className={styles.input} min="0" />
                    <p className={styles.hint}>0 = immediate secondary trading</p>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Minimum KYC Tier</label>
                    <select value={form.minimumKycTier} onChange={(e) => handleChange('minimumKycTier', e.target.value)}
                      className={`${styles.input} ${styles.select}`}>
                      <option value="1">Tier 1 — Retail (≤ $12K/yr)</option>
                      <option value="2">Tier 2 — Accredited (≤ $600K/yr)</option>
                      <option value="3">Tier 3 — Institutional</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <hr className={styles.divider} />

            {/* ── 3. Ownership & Custody ── */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Ownership & Custody</h2>
                <p className={styles.sectionSub}>Committed on-chain when your ASA is deployed after admin approval.</p>
              </div>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label className={styles.label}>SPV Entity Name</label>
                  <input value={form.spvEntityName} onChange={(e) => handleChange('spvEntityName', e.target.value)}
                    placeholder="Gold Holdings SPV I Pte Ltd" className={styles.input} />
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Custodian Name</label>
                    <input value={form.custodianName} onChange={(e) => handleChange('custodianName', e.target.value)}
                      placeholder="Brinks Singapore Pte Ltd" className={styles.input} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Custodian Jurisdiction</label>
                    <input value={form.custodianJurisdiction}
                      onChange={(e) => handleChange('custodianJurisdiction', e.target.value.toUpperCase())}
                      placeholder="SG" maxLength={3} className={`${styles.input} ${styles.inputUpper}`} />
                    <p className={styles.hint}>ISO 3166 (e.g. SG, US, GB)</p>
                  </div>
                </div>
              </div>
            </div>

            <hr className={styles.divider} />

            {/* ── Notice & errors ── */}
            <div className={styles.fields}>
              <div className={styles.infoBox}>
                <svg className={styles.infoBoxIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>
                  <strong>After submission:</strong> Upload ownership proof documents (vault receipts, legal opinions,
                  valuation reports). SHA-256 hashes are stored immutably in your ASA on Algorand.
                </span>
              </div>

              {(txError || mutation.isError) && (
                <div className={styles.errorBox}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>
                    {txError ||
                      ((mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                        (mutation.error as Error)?.message ??
                        'Failed to submit. Please try again.')}
                  </span>
                </div>
              )}
            </div>

            {/* ── Actions ── */}
            <div className={styles.formActions}>
              <button type="submit" disabled={isPending || liquidityAmount <= 0} className={styles.submitBtn}>
                {isPending && <span className={styles.spinner} />}
                {STAGE_LABEL[isPending ? stage : 'idle']}
              </button>
              <button type="button" onClick={() => router.push('/issue')} disabled={isPending} className={styles.cancelBtn}>
                Cancel
              </button>
            </div>

          </form>

          {/* ══ RIGHT — Sticky sidebar ══ */}
          <aside className={styles.sidebar}>

            {/* Wallet status */}
            {!activeAddress ? (
              <div className={styles.walletAlert}>
                <svg className={styles.walletAlertIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <p className={styles.walletAlertTitle}>Wallet required</p>
                  <p className={styles.walletAlertBody}>Connect your Algorand wallet to sign the liquidity deposit on submit.</p>
                  {wallets?.length ? (
                    <div className={styles.walletConnectLinks}>
                      {wallets.map((w) => (
                        <button key={w.id} type="button" onClick={() => w.connect()} className={styles.walletConnectBtn}>
                          Connect {w.metadata.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className={styles.walletConnected}>
                <span className={styles.walletDot} />
                <span className={styles.walletLabel}>Connected</span>
                <span className={styles.walletAddress}>{activeAddress}</span>
              </div>
            )}

            {/* Progress indicator */}
            {isPending && (
              <div className={styles.progressBox}>
                <span className={styles.spinner} style={{ borderColor: '#ececec', borderTopColor: '#0a0a0a' }} />
                <span className={styles.progressLabel}>{STAGE_LABEL[stage]}</span>
              </div>
            )}

            {/* Token preview card */}
            <div className={styles.previewCard}>
              {form.ticker || form.name ? (
                <>
                  <div className={styles.previewCardTop}>
                    <div className={styles.previewHead}>
                      <div
                        className={styles.previewIcon}
                        style={!logoPreview ? { background: iconBg } : { background: 'transparent', border: '1px solid #ececec' }}
                      >
                        {logoPreview
                          ? <img src={logoPreview} alt="preview" className={styles.previewIconImg} />
                          : iconLabel
                        }
                      </div>
                      <div>
                        <div className={styles.previewTicker}>{form.ticker || '—'}</div>
                        <div className={styles.previewName}>{form.name || 'Unnamed asset'}</div>
                      </div>
                    </div>
                    <div className={styles.previewBadges}>
                      {form.category && (
                        <span className={styles.previewBadge}>{CATEGORY_LABELS[form.category]}</span>
                      )}
                      {form.minimumKycTier && (
                        <span className={styles.previewBadge}>KYC Tier {form.minimumKycTier}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.previewStats}>
                    <div>
                      <p className={styles.previewStatLabel}>Pool Supply</p>
                      <p className={styles.previewStatValue}>
                        {estimatedTokens > 0 ? `~${estimatedTokens.toLocaleString()}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className={styles.previewStatLabel}>Price</p>
                      <p className={styles.previewStatValue}>
                        {form.pricePerToken ? `$${parseFloat(form.pricePerToken).toFixed(2)}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className={styles.previewStatLabel}>Deposit</p>
                      <p className={styles.previewStatValue}>
                        {liquidityAmount > 0 ? `$${liquidityAmount.toLocaleString()}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className={styles.previewStatLabel}>Allocation</p>
                      <p className={styles.previewStatValue}>
                        {estimatedTokens > 0 ? `~${estimatedTokens.toLocaleString()}` : '—'}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <p className={styles.previewEmpty}>Fill in the form to see a live preview of your token listing.</p>
              )}
            </div>

          </aside>
        </div>

      </div>
    </div>
  );
}
