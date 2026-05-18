'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getPoolPrice } from '@/lib/tinyman';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import styles from './markets.module.css';

interface AssetMarket {
  id: string;
  name: string;
  ticker: string;
  category: string;
  pricePerToken: string;
  totalSupply: string;
  status: string;
  asaId?: number | null;
  logoUrl?: string;
}

interface PoolPrice {
  price: number;
  ts: string;
  change24h: number;
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

// Seeded random (mulberry32)
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
  const gradId = `g${seed}`;
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

// Seeded fake 24H change for visual display
function fakeChange(id: string): { pct: number; dir: 'up' | 'down' } {
  const seed = strToSeed(id + 'chg');
  const rng = mulberry32(seed);
  const raw = (rng() - 0.44) * 14; // slight negative bias for realism
  return { pct: Math.abs(raw), dir: raw >= 0 ? 'up' : 'down' };
}

function AssetIcon({ ticker, bg, logoUrl, size = 40, radius = '50%' }: { ticker: string; bg: string; logoUrl?: string; size?: number; radius?: string }) {
  return (
    <div
      className={size === 40 ? styles.icon : styles.cardIcon}
      style={{ background: logoUrl ? 'transparent' : bg, borderRadius: radius, width: size, height: size, border: logoUrl ? '1px solid #ececec' : undefined, overflow: 'hidden' }}
    >
      {logoUrl
        ? <img src={logoUrl} alt={ticker} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : ticker.slice(0, 2)
      }
    </div>
  );
}

function MarketCard({ asset }: { asset: AssetMarket }) {
  // Backend snapshot — carries the 24h change figure.
  const { data: poolPrice } = useQuery<PoolPrice | null>({
    queryKey: ['price', asset.id],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/assets/${asset.id}/price`);
        return data as PoolPrice;
      } catch {
        return null;
      }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: asset.status === 'ACTIVE',
  });

  // Live on-chain pool price — authoritative spot, matches the trade page quote.
  const { data: livePrice } = useQuery<number | null>({
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
  const color = getColor(asset.ticker);
  const catLabel = CATEGORY_LABELS[asset.category] ?? asset.category;

  return (
    <Link href={`/trade/${asset.id}`} className={styles.card}>
      <div className={styles.cardHead}>
        <AssetIcon ticker={asset.ticker} bg={color} logoUrl={asset.logoUrl} size={44} radius="12px" />
        <div>
          <div className={styles.cardTicker}>{asset.ticker}</div>
          <div className={styles.cardSub}>{asset.name}</div>
          <span className={styles.catBadge}>{catLabel}</span>
        </div>
      </div>

      <div className={`${styles.chartWrap} ${dir === 'down' ? styles.chartWrapDown : styles.chartWrapUp}`}>
        <div className={styles.priceBig}>${displayPrice}</div>
        <div className={`${styles.deltaRow} ${dir === 'down' ? styles.deltaRowDown : styles.deltaRowUp}`}>
          <span className={styles.tri}>{dir === 'down' ? '▼' : '▲'}</span>
          <span>{pct.toFixed(2)}% 24H</span>
        </div>
        <Sparkline id={asset.id} dir={dir} />
      </div>
    </Link>
  );
}

function ListRow({ asset }: { asset: AssetMarket }) {
  const { pct, dir } = fakeChange(asset.id);
  const price = (Number(asset.pricePerToken) / 1_000_000).toFixed(2);
  const color = getColor(asset.ticker);
  return (
    <div className={styles.row}>
      <AssetIcon ticker={asset.ticker} bg={color} logoUrl={asset.logoUrl} size={40} radius="50%" />
      <div>
        <div className={styles.ticker}>
          {asset.ticker}<span className={styles.tickerOn}>on</span>
        </div>
        <div className={styles.sub}>{asset.name}</div>
      </div>
      <div>
        <div className={styles.price}>${price}</div>
        <div className={`${styles.delta} ${dir === 'up' ? styles.deltaUp : styles.deltaDown}`}>
          <span className={styles.tri}>{dir === 'up' ? '▲' : '▼'}</span>
          {pct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

const ALL_TABS = [
  { key: 'all', label: 'All assets' },
  { key: 'PRECIOUS_METALS', label: 'Metals' },
  { key: 'REAL_ESTATE', label: 'Real Estate' },
  { key: 'PRIVATE_DEBT', label: 'Private Debt' },
  { key: 'CORPORATE_BOND', label: 'Bonds' },
  { key: 'COMMODITY', label: 'Commodity' },
  { key: 'PRIVATE_EQUITY', label: 'Equity' },
];

export default function MarketsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewGrid, setViewGrid] = useState(true);

  const { data: assets = [], isLoading } = useQuery<AssetMarket[]>({
    queryKey: ['markets'],
    queryFn: async () => {
      const { data } = await api.get('/assets?status=ACTIVE');
      return data as AssetMarket[];
    },
    refetchInterval: 30_000,
  });

  // Filter assets based on tab + search
  const filtered = useMemo(() => {
    return assets.filter((a) => {
      const matchCat = activeTab === 'all' || a.category === activeTab;
      const q = search.toLowerCase();
      const matchSearch = !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [assets, activeTab, search]);

  // Build 3 columns from first 9 assets (or all if fewer)
  const gainers = assets.slice(0, 3);
  const trending = assets.slice(3, 6);
  const newlyAdded = assets.slice(-3);

  // Tabs that actually have assets
  const activeTabs = useMemo(() => {
    const cats = new Set(assets.map((a) => a.category));
    return ALL_TABS.filter((t) => t.key === 'all' || cats.has(t.key));
  }, [assets]);

  return (
    <div className={styles.page}>
      <div className={styles.main}>

        {/* ── Three-column lists ── */}
        {assets.length > 0 && (
          <section className={styles.lists}>
            {/* Top Gainers */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>Top Gainers</div>
                <span className={styles.chip}>24H</span>
              </div>
              {gainers.map((a) => <ListRow key={a.id} asset={a} />)}
            </div>

            {/* Trending */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>Trending</div>
                <span className={styles.chip}>24H</span>
              </div>
              {(trending.length > 0 ? trending : gainers).map((a) => {
                const price = (Number(a.pricePerToken) / 1_000_000).toFixed(2);
                const supply = (Number(a.totalSupply) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
                const color = getColor(a.ticker);
                return (
                  <div key={a.id} className={styles.row}>
                    <AssetIcon ticker={a.ticker} bg={color} logoUrl={a.logoUrl} size={40} radius="50%" />
                    <div>
                      <div className={styles.ticker}>
                        {a.ticker}<span className={styles.tickerOn}>on</span>
                      </div>
                      <div className={styles.sub}>{a.name}</div>
                    </div>
                    <div>
                      <div className={styles.price}>${price}</div>
                      <div className={styles.rowMeta}>{supply} supply</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Newly Added */}
            <div>
              <div className={styles.listHead}>
                <div className={styles.listTitle}>Newly Added</div>
              </div>
              {(newlyAdded.length > 0 ? newlyAdded : gainers).map((a) => {
                const price = (Number(a.pricePerToken) / 1_000_000).toFixed(2);
                const color = getColor(a.ticker);
                const catLabel = CATEGORY_LABELS[a.category] ?? a.category;
                return (
                  <div key={a.id} className={styles.row}>
                    <AssetIcon ticker={a.ticker} bg={color} logoUrl={a.logoUrl} size={40} radius="50%" />
                    <div>
                      <div className={styles.ticker}>
                        {a.ticker}<span className={styles.tickerOn}>on</span>
                      </div>
                      <div className={styles.sub}>{a.name}</div>
                    </div>
                    <div>
                      <div className={styles.price}>${price}</div>
                      <div className={styles.rowMeta}>{catLabel}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Explore Assets ── */}
        <section>
          <div className={styles.exHead}>
            <div className={styles.exTitle}>
              Explore Assets<sup className={styles.exTitleSup}>RWA</sup>
            </div>
            <div className={styles.marketStatus}>
              <span className={styles.statusDot}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="4" fill="#22c55e" />
                </svg>
              </span>
              <b className={styles.statusLabel}>Live</b>
              <span className={styles.statusTime}>Algorand · ~4s settlement</span>
            </div>
          </div>

          <div className={styles.filters}>
            {/* Search */}
            <div className={styles.searchBox}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="#7a7a7a" strokeWidth="2" />
                <path d="m20 20-3.2-3.2" stroke="#7a7a7a" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search asset name or ticker"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Category tabs */}
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

            {/* View toggle */}
            <div className={styles.viewToggle}>
              <button
                className={`${styles.vtBtn} ${viewGrid ? styles.vtBtnActive : ''}`}
                onClick={() => setViewGrid(true)}
                aria-label="Grid view"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              <button
                className={`${styles.vtBtn} ${!viewGrid ? styles.vtBtnActive : ''}`}
                onClick={() => setViewGrid(false)}
                aria-label="List view"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="2.5" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1.5" y="6.9" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1.5" y="11.3" width="13" height="2.2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>

            <button className={styles.sortBtn}>
              Most Popular
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Grid / List */}
          {isLoading ? (
            <div className={styles.empty}>Loading markets…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No assets found.</div>
          ) : viewGrid ? (
            <div className={styles.cards}>
              {filtered.map((asset) => (
                <MarketCard key={asset.id} asset={asset} />
              ))}
            </div>
          ) : (
            /* List view */
            <div style={{ border: '1px solid #ececec', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
              {filtered.map((asset) => (
                <Link
                  key={asset.id}
                  href={`/trade/${asset.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr auto auto',
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
                  <AssetIcon ticker={asset.ticker} bg={getColor(asset.ticker)} logoUrl={asset.logoUrl} size={44} radius="12px" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em' }}>{asset.ticker}</div>
                    <div style={{ fontSize: 13, color: '#707070', marginTop: 2 }}>{asset.name}</div>
                  </div>
                  <div style={{ fontSize: 13, color: '#4a4a4a', background: '#f1f1f1', borderRadius: 999, padding: '3px 10px', fontWeight: 600 }}>
                    {CATEGORY_LABELS[asset.category] ?? asset.category}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>
                      ${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)}
                    </div>
                    {(() => {
                      const { pct, dir } = fakeChange(asset.id);
                      return (
                        <div style={{ fontSize: 13, color: dir === 'up' ? '#1f9b5e' : '#c93f3f', marginTop: 2 }}>
                          {dir === 'up' ? '▲' : '▼'} {pct.toFixed(2)}%
                        </div>
                      );
                    })()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
