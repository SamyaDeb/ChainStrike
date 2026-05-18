'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getPoolPrice } from '@/lib/tinyman';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import styles from './liquidity.module.css';

interface AssetLP {
  id: string;
  name: string;
  ticker: string;
  category: string;
  pricePerToken: string;
  liquidityDepositUsdc: string;
  status: string;
  asaId?: number | null;
  lpAssetId?: number | null;
  tinymanPoolAddress?: string | null;
  poolTokenAmount?: string | null;
  decimals?: number;
  listedAt?: string | null;
  logoUrl?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  PRECIOUS_METALS: 'Metals',
  REAL_ESTATE: 'Real Estate',
  PRIVATE_DEBT: 'Private Debt',
  CORPORATE_BOND: 'Bonds',
  COMMODITY: 'Commodity',
  PRIVATE_EQUITY: 'Equity',
};

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

// Seeded pseudo-random (mulberry32)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strToSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Seeded chart path
function buildChartPath(seed: number, dir: 'up' | 'down'): { line: string; fill: string } {
  const rng = mulberry32(seed);
  const N = 90, W = 400, H = 120;
  const startY = dir === 'down' ? 26 : 90;
  const endY = dir === 'down' ? 92 : 26;
  const pts: number[] = [];
  for (let i = 0; i < N; i++) {
    const trend = (i / (N - 1)) * (endY - startY);
    const noise = (rng() - 0.5) * 18;
    pts.push(Math.max(8, Math.min(H - 6, startY + trend + noise)));
  }
  let line = '';
  pts.forEach((v, i) => {
    const x = (i / (N - 1)) * W;
    line += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + v.toFixed(2) + ' ';
  });
  const fill = line + `L ${W} ${H} L 0 ${H} Z`;
  return { line, fill };
}

function Sparkline({ id, dir }: { id: string; dir: 'up' | 'down' }) {
  const seed = strToSeed(id);
  const { line, fill } = buildChartPath(seed, dir);
  const gradId = `lg${seed}`;
  const stroke = dir === 'down' ? '#c93f3f' : '#1f9b5e';
  const fillTop = dir === 'down' ? 'rgba(201,63,63,0.28)' : 'rgba(31,155,94,0.28)';
  const fillBot = dir === 'down' ? 'rgba(201,63,63,0.02)' : 'rgba(31,155,94,0.02)';
  return (
    <svg className={styles.chartSvg} viewBox="0 0 400 120" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="100%" stopColor={fillBot} />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Seeded fake 24h change
function fakeChange(id: string): { pct: number; dir: 'up' | 'down' } {
  const seed = strToSeed(id + 'chg');
  const rng = mulberry32(seed);
  const raw = (rng() - 0.44) * 14;
  return { pct: Math.abs(raw), dir: raw >= 0 ? 'up' : 'down' };
}

// Seeded APY between 6% and 22%
function seedApy(id: string): number {
  const rng = mulberry32(strToSeed(id + 'apy'));
  return 6 + rng() * 16;
}

// Simulated 7-day volume as % of TVL
function seedVolume(id: string): number {
  const rng = mulberry32(strToSeed(id + 'vol'));
  return 0.08 + rng() * 0.35;
}

function tvlUsdc(asset: AssetLP): number {
  // Both sides seeded equally at pool creation, so TVL ≈ 2× USDC deposit
  return (Number(asset.liquidityDepositUsdc) / 1_000_000) * 2;
}

function AssetIcon({ ticker, bg, logoUrl, size = 40 }: { ticker: string; bg: string; logoUrl?: string; size?: number }) {
  const radius = size >= 44 ? '12px' : '50%';
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: logoUrl ? 'transparent' : bg,
      display: 'grid', placeItems: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.33,
      overflow: 'hidden', flexShrink: 0,
      border: logoUrl ? '1px solid #ececec' : undefined,
    }}>
      {logoUrl
        ? <img src={logoUrl} alt={ticker} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : ticker.slice(0, 2)
      }
    </div>
  );
}

function LiquidityCard({ asset }: { asset: AssetLP }) {
  const apy = seedApy(asset.id);
  const tvl = tvlUsdc(asset);
  const vol7d = tvl * seedVolume(asset.id);
  const color = getColor(asset.ticker);
  const catLabel = CATEGORY_LABELS[asset.category] ?? asset.category;

  // Backend snapshot price (24h change)
  const { data: poolPrice } = useQuery({
    queryKey: ['price', asset.id],
    queryFn: async () => {
      try { const { data } = await api.get(`/assets/${asset.id}/price`); return data as { price: number; change24h: number } | null; }
      catch { return null; }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: asset.status === 'ACTIVE',
  });

  // Live on-chain pool price
  const { data: livePrice } = useQuery({
    queryKey: ['poolPrice', asset.asaId],
    queryFn: async () => getPoolPrice(asset.asaId as number),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: asset.status === 'ACTIVE' && !!asset.asaId,
  });

  const listingPrice = (Number(asset.pricePerToken) / 1_000_000).toFixed(4);
  const displayPrice = livePrice != null
    ? livePrice.toFixed(4)
    : poolPrice ? poolPrice.price.toFixed(4) : listingPrice;

  const liveChange = poolPrice?.change24h;
  const { pct: fakePct, dir: fakeDir } = fakeChange(asset.id);
  const pct = liveChange != null ? Math.abs(liveChange) : fakePct;
  const dir = liveChange != null ? (liveChange >= 0 ? 'up' : 'down') : fakeDir;

  return (
    <Link href={`/liquidity/${asset.id}`} className={styles.card}>
      <div className={styles.cardHead}>
        <AssetIcon ticker={asset.ticker} bg={color} logoUrl={asset.logoUrl} size={44} />
        <div>
          <div className={styles.cardTicker}>{asset.ticker}</div>
          <div className={styles.cardSub}>{asset.name}</div>
          <span className={styles.catBadge}>{catLabel}</span>
        </div>
      </div>

      <div className={`${styles.chartWrap} ${dir === 'down' ? styles.chartWrapDown : styles.chartWrapUp}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
          {/* Price + delta */}
          <div>
            <div className={styles.priceBig}>${displayPrice}</div>
            <div className={`${styles.deltaRow} ${dir === 'down' ? styles.deltaRowDown : styles.deltaRowUp}`}>
              <span className={styles.tri}>{dir === 'down' ? '▼' : '▲'}</span>
              <span>{pct.toFixed(2)}% 24H</span>
            </div>
          </div>
          {/* APY · TVL · Supply */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {[
              { val: `${apy.toFixed(1)}%`, label: 'APY', color: '#1a7f37' },
              { val: `$${tvl >= 1000 ? (tvl / 1000).toFixed(1) + 'K' : tvl.toFixed(0)}`, label: 'TVL', color: '#0a0a0a' },
              {
                val: (() => {
                  const s = asset.poolTokenAmount && asset.decimals != null
                    ? Number(asset.poolTokenAmount) / 10 ** asset.decimals : null;
                  return s != null ? (s >= 1_000_000 ? (s / 1_000_000).toFixed(1) + 'M' : s >= 1000 ? (s / 1000).toFixed(1) + 'K' : s.toFixed(0)) : '—';
                })(),
                label: 'Supply',
                color: '#0a0a0a',
              },
            ].map(({ val, label, color }) => (
              <div key={label} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: '-0.01em' }}>{val}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <Sparkline id={asset.id} dir={dir} />
      </div>

    </Link>
  );
}

const ALL_TABS = [
  { key: 'all', label: 'All Pools' },
  { key: 'PRECIOUS_METALS', label: 'Metals' },
  { key: 'REAL_ESTATE', label: 'Real Estate' },
  { key: 'PRIVATE_DEBT', label: 'Private Debt' },
  { key: 'CORPORATE_BOND', label: 'Bonds' },
  { key: 'COMMODITY', label: 'Commodity' },
  { key: 'PRIVATE_EQUITY', label: 'Equity' },
];

export default function LiquidityPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewGrid, setViewGrid] = useState(true);

  const { data: assets = [], isLoading } = useQuery<AssetLP[]>({
    queryKey: ['liquidity-markets'],
    queryFn: async () => {
      const { data } = await api.get('/assets?status=ACTIVE');
      return (data as AssetLP[]).filter((a) => a.lpAssetId || a.tinymanPoolAddress);
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      const matchCat = activeTab === 'all' || a.category === activeTab;
      const q = search.toLowerCase();
      const matchSearch = !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [assets, activeTab, search]);

  const activeTabs = useMemo(() => {
    const cats = new Set(assets.map((a) => a.category));
    return ALL_TABS.filter((t) => t.key === 'all' || cats.has(t.key));
  }, [assets]);

  // Suggestion columns
  const byApy = [...assets].sort((a, b) => seedApy(b.id) - seedApy(a.id)).slice(0, 3);
  const byTvl = [...assets].sort((a, b) => tvlUsdc(b) - tvlUsdc(a)).slice(0, 3);
  const newest = [...assets]
    .sort((a, b) => new Date(b.listedAt ?? 0).getTime() - new Date(a.listedAt ?? 0).getTime())
    .slice(0, 3);

  // Aggregate stats for hero
  const totalTvl = assets.reduce((s, a) => s + tvlUsdc(a), 0);
  const avgApy = assets.length ? assets.reduce((s, a) => s + seedApy(a.id), 0) / assets.length : 0;
  const totalPools = assets.length;

  return (
    <div className={styles.page}>
      <div className={styles.main}>

        {/* ── Hero ── */}
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <div className={styles.heroTitle}>
              Earn fees by providing<br />liquidity to RWA pools
            </div>
            <div className={styles.heroSub}>
              Deposit USDC into any active pool. Tinyman automatically pairs your USDC
              with RWA tokens. Earn 0.3% on every swap proportional to your pool share.
            </div>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <div className={styles.heroStatVal}>
                ${totalTvl >= 1000 ? (totalTvl / 1000).toFixed(1) + 'K' : totalTvl.toFixed(0)}
              </div>
              <div className={styles.heroStatLabel}>Total TVL</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatVal}>{avgApy.toFixed(1)}%</div>
              <div className={styles.heroStatLabel}>Avg APY</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatVal}>{totalPools}</div>
              <div className={styles.heroStatLabel}>Active Pools</div>
            </div>
          </div>
        </div>

        {/* ── Suggestion columns ── */}
        {assets.length > 0 && (
          <section className={styles.lists}>
            {/* High APY */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>High APY</div>
                <span className={`${styles.chip} ${styles.chipGreen}`}>Earn More</span>
              </div>
              {byApy.map((a) => (
                <Link key={a.id} href={`/liquidity/${a.id}`} className={styles.row}>
                  <AssetIcon ticker={a.ticker} bg={getColor(a.ticker)} logoUrl={a.logoUrl} size={40} />
                  <div>
                    <div className={styles.ticker}>{a.ticker}</div>
                    <div className={styles.sub}>{a.name}</div>
                  </div>
                  <div>
                    <div className={styles.apy}>{seedApy(a.id).toFixed(1)}%</div>
                    <div className={styles.apyLabel}>APY</div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Deep Liquidity */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>Deep Liquidity</div>
                <span className={`${styles.chip} ${styles.chipBlue}`}>Low Slippage</span>
              </div>
              {byTvl.map((a) => {
                const tvl = tvlUsdc(a);
                return (
                  <Link key={a.id} href={`/liquidity/${a.id}`} className={styles.row}>
                    <AssetIcon ticker={a.ticker} bg={getColor(a.ticker)} logoUrl={a.logoUrl} size={40} />
                    <div>
                      <div className={styles.ticker}>{a.ticker}</div>
                      <div className={styles.sub}>{a.name}</div>
                    </div>
                    <div>
                      <div className={styles.price}>
                        ${tvl >= 1000 ? (tvl / 1000).toFixed(1) + 'K' : tvl.toFixed(0)}
                      </div>
                      <div className={styles.rowMeta}>TVL</div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Newly Listed */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>Newly Listed</div>
              </div>
              {(newest.length > 0 ? newest : byApy).map((a) => (
                <Link key={a.id} href={`/liquidity/${a.id}`} className={styles.row}>
                  <AssetIcon ticker={a.ticker} bg={getColor(a.ticker)} logoUrl={a.logoUrl} size={40} />
                  <div>
                    <div className={styles.ticker}>{a.ticker}</div>
                    <div className={styles.sub}>{a.name}</div>
                  </div>
                  <div>
                    <div className={styles.price}>{CATEGORY_LABELS[a.category] ?? a.category}</div>
                    <div className={styles.rowMeta}>
                      {a.listedAt ? new Date(a.listedAt).toLocaleDateString() : 'Active'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Explore Pools ── */}
        <section>
          <div className={styles.exHead}>
            <div className={styles.exTitle}>
              All Pools<sup className={styles.exTitleSup}>USDC</sup>
            </div>
            <div className={styles.liveStatus}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              <b className={styles.statusLabel}>Live</b>
              <span className={styles.statusTime}>Algorand · ~4s settlement</span>
            </div>
          </div>

          <div className={styles.filters}>
            <div className={styles.searchBox}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="#7a7a7a" strokeWidth="2" />
                <path d="m20 20-3.2-3.2" stroke="#7a7a7a" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search pool name or ticker"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className={styles.tabs}>
              {activeTabs.map((t) => (
                <button
                  key={t.key}
                  className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className={styles.viewToggle}>
              <button className={`${styles.vtBtn} ${viewGrid ? styles.vtBtnActive : ''}`} onClick={() => setViewGrid(true)} aria-label="Grid">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              <button className={`${styles.vtBtn} ${!viewGrid ? styles.vtBtnActive : ''}`} onClick={() => setViewGrid(false)} aria-label="List">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="2.5" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1.5" y="6.9" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1.5" y="11.3" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className={styles.empty}>Loading pools…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No active pools found.</div>
          ) : viewGrid ? (
            <div className={styles.cards}>
              {filtered.map((a) => <LiquidityCard key={a.id} asset={a} />)}
            </div>
          ) : (
            <div style={{ border: '1px solid #ececec', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
              {filtered.map((a) => {
                const apy = seedApy(a.id);
                const tvl = tvlUsdc(a);
                return (
                  <Link
                    key={a.id}
                    href={`/liquidity/${a.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr auto auto auto',
                      alignItems: 'center',
                      gap: 16,
                      padding: '14px 22px',
                      borderBottom: '1px solid #ececec',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <AssetIcon ticker={a.ticker} bg={getColor(a.ticker)} logoUrl={a.logoUrl} size={44} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{a.ticker}</div>
                      <div style={{ fontSize: 13, color: '#707070', marginTop: 2 }}>{a.name}</div>
                    </div>
                    <div style={{ fontSize: 13, color: '#4a4a4a', background: '#f1f1f1', borderRadius: 999, padding: '3px 10px', fontWeight: 600 }}>
                      {CATEGORY_LABELS[a.category] ?? a.category}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#1a7f37' }}>{apy.toFixed(1)}%</div>
                      <div style={{ fontSize: 12, color: '#9a9a9a' }}>APY</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        ${tvl >= 1000 ? (tvl / 1000).toFixed(1) + 'K' : tvl.toFixed(0)}
                      </div>
                      <div style={{ fontSize: 12, color: '#9a9a9a' }}>TVL</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
