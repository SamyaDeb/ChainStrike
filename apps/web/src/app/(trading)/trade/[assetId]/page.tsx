'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PriceChart } from '@/components/trading/price-chart';
import { SwapPanel } from '@/components/trading/swap-panel';
import { getPoolPrice } from '@/lib/tinyman';

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Precious Metals',
  REAL_ESTATE: 'Real Estate',
  PRIVATE_DEBT: 'Private Debt',
  CORPORATE_BOND: 'Corporate Bond',
  COMMODITY: 'Commodity',
  PRIVATE_EQUITY: 'Private Equity',
};

export default function AssetDetailPage({ params }: { params: { assetId: string } }) {
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

  // Backend snapshot price (has 24h change). May be stale or missing.
  const { data: priceInfo } = useQuery({
    queryKey: ['price', assetId],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${assetId}/price`);
      return data as { price: number; ts: string; change24h: number } | null;
    },
    refetchInterval: 30_000,
    enabled: !!asset?.asaId,
  });

  // Live on-chain pool price — same source the swap panel quotes from.
  // This is the authoritative spot price; prefer it over the snapshot.
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
  // Prefer the live on-chain pool price (matches the swap quote), then the
  // backend snapshot, then the listing price as a last resort.
  const currentPrice = livePoolPrice ?? priceInfo?.price ?? listingPrice;
  const change24h = priceInfo?.change24h ?? 0;
  const isPositive = change24h >= 0;
  const priceIsLive = livePoolPrice != null;

  return (
    <div style={page}>
      <div style={wrap}>

        {/* ── Breadcrumb ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: 13, color: '#888' }}>
          <a href="/markets" style={{ color: '#888', textDecoration: 'none' }}>Markets</a>
          <span>/</span>
          <span style={{ color: '#0a0a0a', fontWeight: 600 }}>{asset.ticker}</span>
        </div>

        {/* ── Two-column layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 32, alignItems: 'start' }}>

          {/* LEFT — chart + info */}
          <div>
            {/* Token header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
              {asset.logoUrl && (
                <img
                  src={asset.logoUrl}
                  alt={asset.ticker}
                  style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e5e7eb' }}
                />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
                    {asset.name}
                  </h1>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                    background: '#f5f5f5', color: '#555',
                  }}>
                    {asset.ticker}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                    background: '#f0f0f0', color: '#777',
                  }}>
                    {CATEGORY_LABELS[asset.category] ?? asset.category}
                  </span>
                </div>

                {/* Price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.04em' }}>
                    ${currentPrice.toFixed(4)}
                  </span>
                  <span style={{
                    fontSize: 14, fontWeight: 600,
                    color: isPositive ? '#16a34a' : '#dc2626',
                  }}>
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
              <PriceChart
                assetId={assetId}
                asaId={asset.asaId}
                listingPrice={listingPrice}
              />
            </div>

            {/* ── About ── */}
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 28 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>About {asset.name}</h2>
              <p style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 20 }}>
                {asset.description}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px' }}>
                {asset.spvEntityName && (
                  <Detail label="SPV Entity" value={asset.spvEntityName} />
                )}
                {asset.custodianName && (
                  <Detail
                    label="Custodian"
                    value={`${asset.custodianName}${asset.custodianJurisdiction ? ` · ${asset.custodianJurisdiction}` : ''}`}
                  />
                )}
                {asset.lockupDays > 0 && (
                  <Detail label="Lock-up" value={`${asset.lockupDays} days`} />
                )}
                {asset.poolTokenAmount && (
                  <Detail label="Pool Supply" value={`${(Number(asset.poolTokenAmount) / 1_000_000).toLocaleString()} ${asset.ticker}`} />
                )}
                {asset.listedAt && (
                  <Detail label="Listed" value={new Date(asset.listedAt).toLocaleDateString()} />
                )}
                {asset.tinymanPoolAddress && (
                  <Detail label="Pool" value={`${asset.tinymanPoolAddress.slice(0, 8)}…${asset.tinymanPoolAddress.slice(-4)}`} />
                )}
              </div>
            </div>

          </div>

          {/* RIGHT — swap panel */}
          <div style={{ position: 'sticky', top: 80 }}>
            {asset.asaId ? (
              <SwapPanel
                assetId={asset.id}
                asaId={asset.asaId}
                asaDecimals={asset.decimals}
                asaTicker={asset.ticker}
                assetStatus={asset.status}
              />
            ) : (
              <div style={{
                background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 16,
                padding: 24, textAlign: 'center', color: '#888', fontSize: 13,
              }}>
                Token not yet deployed on-chain.
              </div>
            )}
          </div>
        </div>
      </div>
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
