'use client';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import {
  getUsdcAddLiquidityQuote,
  addLiquidityUsdc,
  getUsdcRemoveLiquidityQuote,
  removeLiquidityToUsdc,
} from '@/lib/tinyman';
import { api } from '@/lib/api';

interface Props {
  assetId: string;
  asaId: number;
  lpAsaId: number;
  asaDecimals: number;
  asaTicker: string;
}

type Tab = 'add' | 'remove';
type Gate = 'checking' | 'need-optin-rwa' | 'need-unfreeze' | 'need-optin-lp' | 'ready';

const USDC_ASA_ID = Number(process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941');

function makeAlgod() {
  return new algosdk.Algodv2(
    process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
    process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
    Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443'),
  );
}

function fmt(amount: bigint, decimals: number, dp = 4): string {
  const val = Number(amount) / 10 ** decimals;
  if (val === 0) return '0';
  if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return val.toFixed(dp);
}

function impactColor(pct: number): string {
  if (pct > 5) return '#dc2626';
  if (pct > 1) return '#d97706';
  return '#16a34a';
}

export function LiquidityPanel({ assetId, asaId, lpAsaId, asaDecimals, asaTicker }: Props) {
  const { activeAddress, signTransactions } = useWallet();
  const [tab, setTab] = useState<Tab>('add');

  // Gate
  const [gate, setGate] = useState<Gate>('checking');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Balances
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [lpBalance, setLpBalance] = useState<bigint>(0n);

  // Add state
  const [usdcInput, setUsdcInput] = useState('');
  const [addQuote, setAddQuote] = useState<{ lpOut: bigint; poolSharePct: number; priceImpact: number } | null>(null);
  const [addQuoting, setAddQuoting] = useState(false);
  const addTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remove state
  const [lpInput, setLpInput] = useState('');
  const [removeQuote, setRemoveQuote] = useState<{ usdcOut: bigint; priceImpact: number } | null>(null);
  const [removeQuoting, setRemoveQuoting] = useState(false);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tx
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── Gate check ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeAddress) { setGate('checking'); return; }
    setGate('checking');
    (async () => {
      try {
        const algod = makeAlgod();
        const info = await algod.accountInformation(activeAddress).do();
        const assets: any[] = info['assets'] ?? info.assets ?? [];
        const getId = (a: any) => Number(a['asset-id'] ?? a.assetId ?? a['assetId']);

        const rwaId = Number(asaId);
        const lpId = Number(lpAsaId);

        const rwaHolding = assets.find((a) => getId(a) === rwaId);
        if (!rwaHolding) { setGate('need-optin-rwa'); return; }
        if (rwaHolding['is-frozen'] ?? rwaHolding.isFrozen) { setGate('need-unfreeze'); return; }

        const lpHolding = assets.find((a) => getId(a) === lpId);
        if (!lpHolding) { setGate('need-optin-lp'); return; }

        setUsdcBalance(BigInt(assets.find((a) => getId(a) === USDC_ASA_ID)?.amount ?? 0));
        setLpBalance(BigInt(lpHolding.amount ?? 0));
        setGate('ready');
      } catch {
        setGate('checking');
      }
    })();
  }, [activeAddress, asaId, lpAsaId, refreshNonce]);

  // ── Gate actions ─────────────────────────────────────────────────────────────
  async function handleOptInRwa() {
    if (!activeAddress || !signTransactions) return;
    setGateBusy(true); setGateError('');
    try {
      const algod = makeAlgod();
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: activeAddress,
        assetIndex: Number(asaId), amount: 0, suggestedParams: sp,
      });
      const signed = await signTransactions([txn.toByte()]);
      if (!signed[0]) throw new Error('Wallet declined.');
      await algod.sendRawTransaction(signed[0]).do();
      await new Promise((r) => setTimeout(r, 8000));
      await api.post(`/assets/${assetId}/dev-unfreeze`, { walletAddress: activeAddress });
      setRefreshNonce((n) => n + 1);
    } catch (e: any) { setGateError(e.message ?? 'Failed.'); }
    finally { setGateBusy(false); }
  }

  async function handleUnfreeze() {
    if (!activeAddress) return;
    setGateBusy(true); setGateError('');
    try {
      await api.post(`/assets/${assetId}/dev-unfreeze`, { walletAddress: activeAddress });
      setRefreshNonce((n) => n + 1);
    } catch (e: any) { setGateError(e.message ?? 'Failed.'); }
    finally { setGateBusy(false); }
  }

  async function handleOptInLp() {
    if (!activeAddress || !signTransactions) return;
    setGateBusy(true); setGateError('');
    try {
      const algod = makeAlgod();
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: activeAddress,
        assetIndex: Number(lpAsaId), amount: 0, suggestedParams: sp,
      });
      const signed = await signTransactions([txn.toByte()]);
      if (!signed[0]) throw new Error('Wallet declined.');
      await algod.sendRawTransaction(signed[0]).do();
      await new Promise((r) => setTimeout(r, 5000));
      setRefreshNonce((n) => n + 1);
    } catch (e: any) { setGateError(e.message ?? 'Failed.'); }
    finally { setGateBusy(false); }
  }

  // ── Add quote ────────────────────────────────────────────────────────────────
  function onUsdcInput(val: string) {
    setUsdcInput(val);
    setAddQuote(null);
    if (addTimer.current) clearTimeout(addTimer.current);
    if (!val || isNaN(Number(val)) || Number(val) <= 0) return;
    addTimer.current = setTimeout(async () => {
      setAddQuoting(true);
      try {
        const micro = BigInt(Math.round(Number(val) * 1e6));
        const q = await getUsdcAddLiquidityQuote({ asaId: Number(asaId), asaDecimals, usdcAmount: micro });
        setAddQuote({ lpOut: q.lpOut, poolSharePct: q.poolSharePct, priceImpact: q.priceImpact });
      } catch { setAddQuote(null); }
      finally { setAddQuoting(false); }
    }, 600);
  }

  // ── Remove quote ─────────────────────────────────────────────────────────────
  function onLpInput(val: string) {
    setLpInput(val);
    setRemoveQuote(null);
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (!val || isNaN(Number(val)) || Number(val) <= 0) return;
    removeTimer.current = setTimeout(async () => {
      setRemoveQuoting(true);
      try {
        const micro = BigInt(Math.round(Number(val) * 1e6));
        const q = await getUsdcRemoveLiquidityQuote({ asaId: Number(asaId), asaDecimals, lpAmount: micro });
        setRemoveQuote(q);
      } catch { setRemoveQuote(null); }
      finally { setRemoveQuoting(false); }
    }, 600);
  }

  // ── Execute add ───────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!activeAddress || !signTransactions || !usdcInput) return;
    setBusy(true); setTxError(''); setSuccessMsg('');
    try {
      const micro = BigInt(Math.round(Number(usdcInput) * 1e6));
      const { lpReceived } = await addLiquidityUsdc({
        asaId: Number(asaId), asaDecimals,
        usdcAmount: micro,
        initiatorAddr: activeAddress,
        signTransactions,
      });
      setSuccessMsg(`Added! Received ${fmt(lpReceived, 6, 6)} LP tokens.`);
      setUsdcInput(''); setAddQuote(null);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) { setTxError(e.message ?? 'Transaction failed.'); }
    finally { setBusy(false); }
  }

  // ── Execute remove ────────────────────────────────────────────────────────────
  async function handleRemove() {
    if (!activeAddress || !signTransactions || !lpInput) return;
    setBusy(true); setTxError(''); setSuccessMsg('');
    try {
      const micro = BigInt(Math.round(Number(lpInput) * 1e6));
      const { usdcReceived } = await removeLiquidityToUsdc({
        asaId: Number(asaId), asaDecimals,
        lpAmount: micro,
        initiatorAddr: activeAddress,
        signTransactions,
      });
      setSuccessMsg(`Removed! Received ${fmt(usdcReceived, 6, 4)} USDC.`);
      setLpInput(''); setRemoveQuote(null);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) { setTxError(e.message ?? 'Transaction failed.'); }
    finally { setBusy(false); }
  }

  // ── Styles ────────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20,
    fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)',
  };
  const inputRow: React.CSSProperties = {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
  };
  const inputEl: React.CSSProperties = {
    flex: 1, border: 'none', outline: 'none', fontSize: 18, fontWeight: 600,
    background: 'transparent', color: '#0a0a0a', minWidth: 0,
  };
  const ctaBase: React.CSSProperties = {
    width: '100%', padding: '14px 0', borderRadius: 12, fontWeight: 700,
    fontSize: 15, cursor: 'pointer', border: 'none', marginTop: 12,
  };

  // ── No wallet ─────────────────────────────────────────────────────────────────
  if (!activeAddress) {
    return (
      <div style={card}>
        <p style={{ fontSize: 13, color: '#888', textAlign: 'center', margin: 0 }}>
          Connect your wallet to provide liquidity.
        </p>
      </div>
    );
  }

  // ── Gate screens ──────────────────────────────────────────────────────────────
  if (gate === 'checking') {
    return <div style={card}><p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>Checking wallet…</p></div>;
  }

  if (gate === 'need-optin-rwa') {
    return (
      <div style={card}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Opt in to {asaTicker} token</p>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>Required before providing liquidity to this pool.</p>
        {gateError && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{gateError}</p>}
        <button onClick={handleOptInRwa} disabled={gateBusy}
          style={{ ...ctaBase, background: gateBusy ? '#d1fae5' : '#10b981', color: '#fff' }}>
          {gateBusy ? 'Processing…' : `Opt into ${asaTicker}`}
        </button>
      </div>
    );
  }

  if (gate === 'need-unfreeze') {
    return (
      <div style={card}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Enable trading</p>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>Your wallet needs to be whitelisted for this asset.</p>
        {gateError && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{gateError}</p>}
        <button onClick={handleUnfreeze} disabled={gateBusy}
          style={{ ...ctaBase, background: gateBusy ? '#d1fae5' : '#10b981', color: '#fff' }}>
          {gateBusy ? 'Processing…' : 'Enable Trading'}
        </button>
      </div>
    );
  }

  if (gate === 'need-optin-lp') {
    return (
      <div style={card}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Opt in to LP token</p>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
          Your wallet needs to hold the LP token ASA to receive your pool share.
        </p>
        {gateError && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{gateError}</p>}
        <button onClick={handleOptInLp} disabled={gateBusy}
          style={{ ...ctaBase, background: gateBusy ? '#bfdbfe' : '#3b82f6', color: '#fff' }}>
          {gateBusy ? 'Processing…' : 'Opt into LP Token'}
        </button>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={card}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#f3f4f6', borderRadius: 10, padding: 4 }}>
        {(['add', 'remove'] as Tab[]).map((t) => (
          <button key={t}
            onClick={() => { setTab(t); setTxError(''); setSuccessMsg(''); }}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 13,
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#0a0a0a' : '#888',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}>
            {t === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
          </button>
        ))}
      </div>

      {tab === 'add' && (
        <>
          <div style={inputRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, marginBottom: 2 }}>
                USDC
                {usdcBalance > 0n && (
                  <span style={{ cursor: 'pointer', color: '#3b82f6', marginLeft: 8 }}
                    onClick={() => onUsdcInput(fmt(usdcBalance, 6, 6))}>
                    MAX
                  </span>
                )}
              </div>
              <input type="number" placeholder="0" value={usdcInput}
                onChange={(e) => onUsdcInput(e.target.value)} style={inputEl} />
            </div>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#2775ca', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>$</div>
          </div>
          {usdcBalance > 0n && (
            <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              Balance: {fmt(usdcBalance, 6, 4)} USDC
            </p>
          )}

          {addQuoting && <p style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>Getting quote…</p>}
          {addQuote && !addQuoting && (
            <div style={{
              fontSize: 12, color: '#555', marginTop: 8, lineHeight: 1.8,
              background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>LP tokens you receive</span>
                <span style={{ fontWeight: 700 }}>{fmt(addQuote.lpOut, 6, 6)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Your pool share</span>
                <span style={{ fontWeight: 700 }}>{addQuote.poolSharePct.toFixed(4)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Price impact</span>
                <span style={{ fontWeight: 700, color: impactColor(addQuote.priceImpact * 100) }}>
                  {(addQuote.priceImpact * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          )}

          <button onClick={handleAdd} disabled={busy || !usdcInput}
            style={{ ...ctaBase, background: busy || !usdcInput ? '#bfdbfe' : '#3b82f6', color: '#fff' }}>
            {busy ? 'Processing…' : 'Add Liquidity'}
          </button>
        </>
      )}

      {tab === 'remove' && (
        <>
          <div style={inputRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, marginBottom: 2 }}>
                LP Tokens
                {lpBalance > 0n && (
                  <span style={{ cursor: 'pointer', color: '#3b82f6', marginLeft: 8 }}
                    onClick={() => onLpInput(fmt(lpBalance, 6, 6))}>
                    MAX
                  </span>
                )}
              </div>
              <input type="number" placeholder="0" value={lpInput}
                onChange={(e) => onLpInput(e.target.value)} style={inputEl} />
            </div>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#8b5cf6', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>LP</div>
          </div>
          {lpBalance > 0n && (
            <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              Balance: {fmt(lpBalance, 6, 6)} LP
            </p>
          )}

          {removeQuoting && <p style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>Getting quote…</p>}
          {removeQuote && !removeQuoting && (
            <div style={{
              fontSize: 12, color: '#555', marginTop: 8, lineHeight: 1.8,
              background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>You receive (USDC)</span>
                <span style={{ fontWeight: 700 }}>{fmt(removeQuote.usdcOut, 6, 4)} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Price impact</span>
                <span style={{ fontWeight: 700, color: impactColor(removeQuote.priceImpact * 100) }}>
                  {(removeQuote.priceImpact * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          )}

          <button onClick={handleRemove} disabled={busy || !lpInput}
            style={{ ...ctaBase, background: busy || !lpInput ? '#ede9fe' : '#8b5cf6', color: '#fff' }}>
            {busy ? 'Processing…' : 'Remove Liquidity'}
          </button>
        </>
      )}

      {txError && (
        <p style={{
          fontSize: 12, color: '#dc2626', marginTop: 10,
          padding: '8px 12px', background: '#fef2f2', borderRadius: 8,
        }}>{txError}</p>
      )}
      {successMsg && (
        <p style={{
          fontSize: 12, color: '#16a34a', marginTop: 10,
          padding: '8px 12px', background: '#f0fdf4', borderRadius: 8,
        }}>{successMsg}</p>
      )}
    </div>
  );
}
