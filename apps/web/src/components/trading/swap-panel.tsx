'use client';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { getSwapQuote, executeSwap, type SwapSide, type SwapQuoteData } from '@/lib/tinyman';
import { api } from '@/lib/api';

interface Props {
  assetId: string;
  asaId: number;
  asaDecimals: number;
  asaTicker: string;
  assetStatus: string;
}

function makeAlgod() {
  const server = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
  const port   = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT   ?? '443';
  const token  = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN  ?? '';
  return new algosdk.Algodv2(token, server, Number(port));
}

function fmt(amount: bigint, decimals: number, sigFigs = 6): string {
  const divisor = 10 ** decimals;
  const val = Number(amount) / divisor;
  if (val === 0) return '0';
  if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return val.toFixed(Math.min(sigFigs, decimals));
}

function impactColor(impact: number): string {
  if (impact > 0.05) return '#dc2626';
  if (impact > 0.01) return '#d97706';
  return '#16a34a';
}

// Token icon badge — USDC gets a blue circle $, others get a colored circle with first letter
function TokenBadge({ ticker, size = 28 }: { ticker: string; size?: number }) {
  const isUsdc = ticker === 'USDC';
  const bg = isUsdc ? '#2775ca' : '#10b981';
  const label = isUsdc ? '$' : ticker[0]?.toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
    }}>
      {label}
    </div>
  );
}

export function SwapPanel({ assetId, asaId, asaDecimals, asaTicker, assetStatus }: Props) {
  const { activeAddress, signTransactions } = useWallet();
  const [side, setSide] = useState<SwapSide>('buy');
  const [spendInput, setSpendInput] = useState('');

  const [quoteData, setQuoteData]       = useState<SwapQuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError]     = useState('');

  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txError, setTxError]   = useState('');
  const [txId, setTxId]         = useState('');

  const [buyGate, setBuyGate]     = useState<'checking' | 'need-optin' | 'need-unfreeze' | 'ready'>('checking');
  const [gateBusy, setGateBusy]   = useState(false);
  const [gateError, setGateError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spendDecimals   = side === 'buy' ? 6 : asaDecimals;
  const receiveDecimals = side === 'buy' ? asaDecimals : 6;
  const spendToken      = side === 'buy' ? 'USDC' : asaTicker;
  const receiveToken    = side === 'buy' ? asaTicker : 'USDC';
  const isActive        = assetStatus === 'ACTIVE';

  // ── Live quote ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const amount = Number(spendInput);
    if (!amount || amount <= 0 || !isActive) {
      setQuoteData(null); setQuoteError(''); setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true); setQuoteError(''); setQuoteData(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const microAmount = BigInt(Math.round(amount * 10 ** spendDecimals));
        const { data } = await getSwapQuote({ asaId, asaDecimals, side, amount: microAmount });
        setQuoteData(data); setQuoteError('');
      } catch (err: any) {
        setQuoteData(null);
        const msg: string = err?.message ?? '';
        if (msg.includes('NoAvailablePool') || msg.includes('no available pool'))
          setQuoteError('No pool found for this asset.');
        else if (msg.includes('LowSwapAmount') || msg.includes('too low'))
          setQuoteError('Amount is too small to quote.');
        else if (msg.includes('ExceedsAvailableLiquidity') || msg.includes('exceeds'))
          setQuoteError('Amount exceeds pool liquidity.');
        else
          setQuoteError('Unable to fetch quote.');
      } finally {
        setQuoteLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [spendInput, side, asaId, asaDecimals, isActive, spendDecimals]);

  // ── Opt-in + freeze check ───────────────────────────────────────────────────
  useEffect(() => {
    if (side !== 'buy' || !activeAddress || !isActive) return;
    let cancelled = false;
    setBuyGate('checking'); setGateError('');
    makeAlgod().accountAssetInformation(activeAddress, asaId).do()
      .then((info: any) => {
        if (cancelled) return;
        const holding = info?.assetHolding ?? info?.['asset-holding'];
        if (!holding) { setBuyGate('need-optin'); return; }
        setBuyGate((holding.isFrozen ?? holding['is-frozen']) ? 'need-unfreeze' : 'ready');
      })
      .catch(() => { if (!cancelled) setBuyGate('need-optin'); });
    return () => { cancelled = true; };
  }, [side, activeAddress, asaId, isActive, refreshNonce]);

  // ── Opt-in then unfreeze ───────────────────────────────────────────────────
  async function handleOptIn() {
    if (!activeAddress || !signTransactions) return;
    setGateBusy(true); setGateError('');
    try {
      const client = makeAlgod();
      const sp = await client.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: activeAddress,
        amount: 0, assetIndex: asaId, suggestedParams: sp,
      });
      const signed = await (signTransactions as any)([txn.toByte()]);
      if (!signed[0]) throw new Error('Wallet declined to sign.');
      await client.sendRawTransaction(signed[0]).do();
      await algosdk.waitForConfirmation(client, txn.txID(), 4);
      await api.post(`/assets/${assetId}/dev-unfreeze`, { walletAddress: activeAddress });
      setRefreshNonce((n) => n + 1);
    } catch (err: any) {
      setGateError(err?.response?.data?.message ?? err?.message ?? 'Opt-in failed.');
    } finally {
      setGateBusy(false);
    }
  }

  // ── Unfreeze only ─────────────────────────────────────────────────────────
  async function handleUnfreeze() {
    if (!activeAddress) return;
    setGateBusy(true); setGateError('');
    try {
      await api.post(`/assets/${assetId}/dev-unfreeze`, { walletAddress: activeAddress });
      setRefreshNonce((n) => n + 1);
    } catch (err: any) {
      setGateError(err?.response?.data?.message ?? err?.message ?? 'Unfreeze failed.');
    } finally {
      setGateBusy(false);
    }
  }

  // ── Switch side ────────────────────────────────────────────────────────────
  function switchSide(newSide: SwapSide) {
    setSide(newSide);
    setSpendInput(''); setQuoteData(null); setQuoteError('');
    setTxStatus('idle'); setTxError('');
    setBuyGate('checking'); setGateError('');
  }

  // ── Execute swap ──────────────────────────────────────────────────────────
  async function handleSwap() {
    if (!activeAddress || !signTransactions || !spendInput || !isActive) return;
    setTxStatus('pending'); setTxError(''); setTxId('');
    try {
      const microAmount = BigInt(Math.round(Number(spendInput) * 10 ** spendDecimals));
      const { result } = await executeSwap({
        asaId, asaDecimals, side, amount: microAmount,
        initiatorAddr: activeAddress,
        signTransactions: signTransactions as any,
      });
      setTxId((result as any).txnID ?? '');
      setTxStatus('success');
      setSpendInput(''); setQuoteData(null);
    } catch (err: any) {
      setTxError(err?.message ?? 'Swap failed.');
      setTxStatus('error');
    }
  }

  const canSwap = !!activeAddress && isActive && !!spendInput && Number(spendInput) > 0 && txStatus !== 'pending';
  const receiveDisplay = quoteLoading
    ? '…'
    : quoteData
    ? fmt(quoteData.assetOutMin, receiveDecimals)
    : '0';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: '#f0f2f4',
      borderRadius: 24,
      padding: 16,
      fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)',
      WebkitFontSmoothing: 'antialiased',
    }}>

      {/* ── Header row: Buy/Sell tabs + status ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          display: 'inline-flex', background: '#fff', borderRadius: 12, padding: 4, gap: 2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {(['buy', 'sell'] as SwapSide[]).map((s) => (
            <button
              key={s}
              onClick={() => switchSide(s)}
              style={{
                padding: '7px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em',
                transition: 'all 0.15s',
                background: side === s ? '#111' : 'transparent',
                color: side === s ? '#fff' : '#999',
              }}
            >
              {s === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>

        {/* Asset status pill */}
        {isActive ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', borderRadius: 10, padding: '7px 14px',
            fontSize: 13, fontWeight: 600, color: '#16a34a',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            Live
          </div>
        ) : (
          <div style={{
            background: '#fff', borderRadius: 10, padding: '7px 14px',
            fontSize: 13, fontWeight: 600, color: '#d97706',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            {assetStatus === 'PRE_MARKET' ? 'Pre-Market' : 'Not Listed'}
          </div>
        )}
      </div>

      {/* ── Main swap card ── */}
      <div style={{
        background: '#fff',
        borderRadius: 18,
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
        overflow: 'visible',
        position: 'relative',
      }}>

        {/* Spend section */}
        <div style={{ padding: '18px 20px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#999', marginBottom: 10 }}>
            Spend
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <input
              type="number"
              placeholder="0"
              value={spendInput}
              onChange={(e) => setSpendInput(e.target.value)}
              disabled={txStatus === 'pending' || !isActive}
              style={{
                flex: 1, border: 'none', background: 'transparent', outline: 'none',
                fontSize: 38, fontWeight: 400, color: spendInput ? '#111' : '#c8cacd',
                fontFamily: 'inherit', minWidth: 0,
              }}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#f0f2f4', borderRadius: 40, padding: '8px 14px 8px 8px',
              flexShrink: 0,
            }}>
              <TokenBadge ticker={spendToken} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{spendToken}</span>
            </div>
          </div>
        </div>

        {/* Divider with clickable arrow — click to flip buy↔sell */}
        <div style={{ position: 'relative', height: 1, background: '#f0f2f4' }}>
          <button
            onClick={() => switchSide(side === 'buy' ? 'sell' : 'buy')}
            title="Flip direction"
            style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 36, height: 36, borderRadius: '50%',
              background: '#fff', border: '1.5px solid #e8eaed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, color: '#555', zIndex: 1,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translate(-50%, -50%) rotate(180deg)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translate(-50%, -50%) rotate(0deg)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
            }}
          >
            ↕
          </button>
        </div>

        {/* Receive section */}
        <div style={{ padding: '20px 20px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#999', marginBottom: 10 }}>
            Receive at least
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{
              flex: 1, fontSize: 38, fontWeight: 400,
              color: quoteData && !quoteLoading ? '#111' : '#c8cacd',
            }}>
              {receiveDisplay}
            </span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#f0f2f4', borderRadius: 40, padding: '8px 14px 8px 8px',
              flexShrink: 0,
            }}>
              <TokenBadge ticker={receiveToken} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{receiveToken}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quote error ── */}
      {quoteError && !quoteLoading && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: 12, fontSize: 12, color: '#92400e', fontWeight: 500,
        }}>
          {quoteError}
        </div>
      )}

      {/* ── Quote details ── */}
      {quoteData && !quoteLoading && (
        <div style={{
          marginTop: 10, background: '#fff', borderRadius: 14,
          padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
          {[
            ['Rate', `1 ${spendToken} ≈ ${quoteData.rate > 0 ? quoteData.rate.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 2 }) : '—'} ${receiveToken}`],
            ['Price impact', quoteData.priceImpact > 0 ? `${(quoteData.priceImpact * 100).toFixed(2)}%` : '<0.01%'],
            ['Fee (0.3%)', quoteData.swapFee > 0 ? `${(quoteData.swapFee / 10 ** spendDecimals).toFixed(4)} ${spendToken}` : '—'],
            ['Min received', `${fmt(quoteData.assetOutMin, receiveDecimals)} ${receiveToken}`],
          ].map(([label, value], i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 0',
              borderTop: i > 0 ? '1px solid #f5f5f5' : undefined,
            }}>
              <span style={{ fontSize: 12, color: '#aaa', fontWeight: 500 }}>{label}</span>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: label === 'Price impact' ? impactColor(quoteData.priceImpact) : '#374151',
              }}>{value}</span>
            </div>
          ))}
          {quoteData.priceImpact > 0.05 && (
            <div style={{
              marginTop: 8, padding: '6px 10px',
              background: '#fef2f2', borderRadius: 8,
              fontSize: 11, color: '#dc2626', fontWeight: 500,
            }}>
              High price impact — consider splitting into smaller trades.
            </div>
          )}
        </div>
      )}

      {/* ── CTA ── */}
      <div style={{ marginTop: 12 }}>
        {!activeAddress ? (
          <button style={ctaStyle('#111', false)}>
            Connect Wallet
          </button>
        ) : side === 'buy' && isActive && buyGate === 'checking' ? (
          <button style={ctaStyle('#111', true)}>Checking wallet…</button>
        ) : side === 'buy' && isActive && buyGate === 'need-optin' ? (
          <div>
            <div style={{
              marginBottom: 10, padding: '10px 14px',
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
              fontSize: 12, color: '#92400e', fontWeight: 500,
            }}>
              Opt into <strong>{asaTicker}</strong> to enable trading — your wallet will be unfrozen automatically.
            </div>
            <button onClick={handleOptIn} disabled={gateBusy} style={ctaStyle('#1d4ed8', gateBusy)}>
              {gateBusy ? 'Enabling trading…' : `Opt into ${asaTicker} & enable trading`}
            </button>
            {gateError && <p style={errorStyle}>{gateError}</p>}
          </div>
        ) : side === 'buy' && isActive && buyGate === 'need-unfreeze' ? (
          <div>
            <div style={{
              marginBottom: 10, padding: '10px 14px',
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
              fontSize: 12, color: '#92400e', fontWeight: 500,
            }}>
              Your wallet is opted in but frozen. Enable trading to receive tokens.
            </div>
            <button onClick={handleUnfreeze} disabled={gateBusy} style={ctaStyle('#1d4ed8', gateBusy)}>
              {gateBusy ? 'Enabling trading…' : 'Enable trading'}
            </button>
            {gateError && <p style={errorStyle}>{gateError}</p>}
          </div>
        ) : (
          <button onClick={handleSwap} disabled={!canSwap} style={ctaStyle('#111', !canSwap)}>
            {txStatus === 'pending'
              ? 'Signing & broadcasting…'
              : side === 'buy'
              ? `Buy ${asaTicker}`
              : `Sell ${asaTicker}`}
          </button>
        )}
      </div>

      {/* ── Tx feedback ── */}
      {txStatus === 'success' && (
        <div style={{
          marginTop: 12, padding: '12px 16px',
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14,
        }}>
          <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, margin: 0 }}>Swap confirmed ✓</p>
          {txId && (
            <a
              href={`https://testnet.explorer.perawallet.app/tx/${txId}`}
              target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: '#16a34a', textDecoration: 'underline', marginTop: 4, display: 'block' }}
            >
              View on explorer ↗
            </a>
          )}
        </div>
      )}
      {txStatus === 'error' && txError && (
        <p style={{ ...errorStyle, marginTop: 12 }}>{txError}</p>
      )}

      <p style={{ marginTop: 12, fontSize: 11, color: '#bbb', textAlign: 'center', margin: '12px 0 0' }}>
        Powered by Tinyman V2 · 0.5% slippage
      </p>
    </div>
  );
}

// ── Style helpers ────────────────────────────────────────────────────────────

function ctaStyle(bg: string, disabled: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '16px 0', borderRadius: 16, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#e5e7eb' : bg,
    color: disabled ? '#9ca3af' : '#fff',
    fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em',
    transition: 'opacity 0.15s',
    fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)',
  };
}

const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#dc2626',
  background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 10, padding: '8px 12px', margin: '8px 0 0',
};
