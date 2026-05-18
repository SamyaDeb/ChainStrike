'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PriceChart } from '@/components/trading/price-chart';
import { LiquidityPanel } from '@/components/trading/liquidity-panel';
import { getPoolPrice } from '@/lib/tinyman';

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Precious Metals',
  REAL_ESTATE: 'Real Estate',
  PRIVATE_DEBT: 'Private Debt',
  CORPORATE_BOND: 'Corporate Bond',
  COMMODITY: 'Commodity',
  PRIVATE_EQUITY: 'Private Equity',
};

// Seeded APY (same formula as listing page for consistency)
function strToSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedApy(id: string): number {
  const rng = mulberry32(strToSeed(id + 'apy'));
  return 6 + rng() * 16;
}

export default function LiquidityAssetPage({ params }: { params: { assetId: string } }) {
  const { assetId } = params;

  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${assetId}`);
      return data as {
        id: string;
        name: string;
        ticker: string;
        category: string;
        description: string;
        status: string;
        asaId: number | null;
        decimals: number;
        pricePerToken: string;
        liquidityDepositUsdc: string;
        poolTokenAmount: string | null;
        tinymanPoolAddress: string | null;
        lpAssetId: number | null;
        custodianName: string | null;
        custodianJurisdiction: string | null;
        spvEntityName: string | null;
        minimumInvestment: string;
        lockupDays: number;
        listedAt: string | null;
        logoUrl: string | null;
      };
    },
  });

  const { data: priceInfo } = useQuery({
    queryKey: ['price', assetId],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${assetId}/price`);
      return data as { price: number; ts: string; change24h: number } | null;
    },
    refetchInterval: 30_000,
    enabled: !!asset?.asaId,
  });

  const { data: livePoolPrice } = useQuery({
    queryKey: ['poolPrice', asset?.asaId],
    queryFn: async () => getPoolPrice(asset!.asaId as number),
    refetchInterval: 15_000,
    enabled: !!asset?.asaId && asset?.status === 'ACTIVE',
  });

  const page: React.CSSProperties = {
    background: '#fff',
    minHeight: '100vh',
    fontFamily: 'var(--font-plus-jakarta, "Plus Jakarta Sans", system-ui)',
    color: '#0a0a0a',
    WebkitFontSmoothing: 'antialiased',
  };

  const wrap: React.CSSProperties = {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '32px 24px 80px',
  };

  if (isLoading || !asset) {
    return (
      <div style={page}>
        <div style={wrap}>
          <div style={{ color: '#aaa', fontSize: 14 }}>Loading…</div>
        </div>
      </div>
    );
  }

  const listingPrice = Number(asset.pricePerToken) / 1_000_000;
  const currentPrice = livePoolPrice ?? priceInfo?.price ?? listingPrice;
  const change24h = priceInfo?.change24h ?? 0;
  const isPositive = change24h >= 0;
  const priceIsLive = livePoolPrice != null;

  const tvl = (Number(asset.liquidityDepositUsdc) / 1_000_000) * 2;
  const apy = seedApy(asset.id);

  return (
    <div style={page}>
      <div style={wrap}>

        {/* ── Breadcrumb ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: 13, color: '#888' }}>
          <a href="/liquidity" style={{ color: '#888', textDecoration: 'none' }}>Liquidity</a>
          <span>/</span>
          <span style={{ color: '#0a0a0a', fontWeight: 600 }}>{asset.ticker}</span>
        </div>

        {/* ── Two-column layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 32, alignItems: 'start' }}>

          {/* LEFT */}
          <div>
            {/* Token header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
              {asset.logoUrl && (
                <img
                  src={asset.logoUrl}
                  alt={asset.ticker}
                  style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e5e7eb', marginTop: 8 }}
                />
              )}
              <div style={{ flex: 1 }}>
                {/* Name row + stats on the right */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
                      {asset.name}
                    </h1>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f5f5f5', color: '#555' }}>
                      {asset.ticker}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f0f0f0', color: '#777' }}>
                      {CATEGORY_LABELS[asset.category] ?? asset.category}
                    </span>
                  </div>

                  {/* Pool stats beside token name */}
                  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexShrink: 0 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>APY</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1a7f37', letterSpacing: '-0.02em' }}>{apy.toFixed(1)}%</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>0.3% swap fee</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TVL</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#0a0a0a', letterSpacing: '-0.02em' }}>
                        ${tvl >= 1000 ? (tvl / 1000).toFixed(1) + 'K' : tvl.toFixed(0)}
                      </div>
                    </div>
                    {asset.poolTokenAmount && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pool Supply</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#0a0a0a', letterSpacing: '-0.02em' }}>
                          {(Number(asset.poolTokenAmount) / 1_000_000).toLocaleString()} {asset.ticker}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price row */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.04em' }}>
                    ${currentPrice.toFixed(4)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: isPositive ? '#16a34a' : '#dc2626' }}>
                    {isPositive ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 4 }}>24h</span>
                  </span>
                  {priceIsLive && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 11, fontWeight: 600, color: '#16a34a',
                      background: '#f0fdf4', padding: '3px 8px', borderRadius: 20,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
                      Live pool price
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Chart */}
            <div style={{ marginBottom: 32 }}>
              <PriceChart assetId={assetId} />
            </div>

            {/* About */}
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 28 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>About {asset.name}</h2>
              <p style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 20 }}>
                {asset.description}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px' }}>
                {asset.spvEntityName && <Detail label="SPV Entity" value={asset.spvEntityName} />}
                {asset.custodianName && (
                  <Detail
                    label="Custodian"
                    value={`${asset.custodianName}${asset.custodianJurisdiction ? ` · ${asset.custodianJurisdiction}` : ''}`}
                  />
                )}
                {asset.lockupDays > 0 && <Detail label="Lock-up" value={`${asset.lockupDays} days`} />}
                {asset.listedAt && <Detail label="Listed" value={new Date(asset.listedAt).toLocaleDateString()} />}
                {asset.tinymanPoolAddress && (
                  <Detail
                    label="Pool"
                    value={`${asset.tinymanPoolAddress.slice(0, 8)}…${asset.tinymanPoolAddress.slice(-4)}`}
                  />
                )}
                {asset.lpAssetId && <Detail label="LP Token ASA" value={String(asset.lpAssetId)} />}
              </div>
            </div>
          </div>

          {/* RIGHT — liquidity panel */}
          <div style={{ position: 'sticky', top: 80 }}>
            {asset.asaId && asset.lpAssetId ? (
              <LiquidityPanel
                assetId={asset.id}
                asaId={asset.asaId}
                lpAsaId={asset.lpAssetId}
                asaDecimals={asset.decimals}
                asaTicker={asset.ticker}
              />
            ) : (
              <div style={{
                background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 16,
                padding: 24, textAlign: 'center', color: '#888', fontSize: 13,
              }}>
                {asset.asaId
                  ? 'Pool not yet activated — liquidity provision opens at activation.'
                  : 'Token not yet deployed on-chain.'
                }
              </div>
            )}

            {/* Quick-trade link */}
            {asset.asaId && (
              <a
                href={`/trade/${asset.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  marginTop: 12, padding: '12px 0', borderRadius: 12,
                  border: '1px solid #e5e7eb', background: '#fff', textDecoration: 'none',
                  fontSize: 14, fontWeight: 600, color: '#555',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0a0a0a'; e.currentTarget.style.color = '#0a0a0a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#555'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
                </svg>
                Trade {asset.ticker} instead
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PoolStat({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <div style={{
      background: '#f9fafb', border: '1px solid #f0f0f0', borderRadius: 12,
      padding: '10px 16px', minWidth: 90,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: valueColor ?? '#0a0a0a' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#0a0a0a' }}>{value}</div>
    </div>
  );
}
