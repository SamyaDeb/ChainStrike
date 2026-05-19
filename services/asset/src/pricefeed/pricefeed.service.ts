import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import algosdk from 'algosdk';
import { poolUtils } from '@tinymanorg/tinyman-js-sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PricefeedService {
  private readonly logger = new Logger(PricefeedService.name);
  private readonly algodClient: algosdk.Algodv2;
  // algosdk v2 client for Tinyman SDK (v3 removed setIntDecoding used internally)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  private readonly tinymanAlgod: any = new (require('@tinymanorg/tinyman-js-sdk/node_modules/algosdk').Algodv2)(
    '', 'https://testnet-api.algonode.cloud', '443',
  );
  private readonly usdcAsaId: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'https://testnet-api.algonode.cloud'),
      this.config.get<string>('ALGORAND_ALGOD_PORT', '443'),
    );
    this.usdcAsaId = this.config.get<string>('ALGORAND_NETWORK') === 'mainnet' ? 31566704 : 10458941;
    // Re-create tinymanAlgod with correct config (constructor-time config is available now)
    const algosdk2 = require('@tinymanorg/tinyman-js-sdk/node_modules/algosdk');
    this.tinymanAlgod = new algosdk2.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'https://testnet-api.algonode.cloud'),
      this.config.get<string>('ALGORAND_ALGOD_PORT', '443'),
    );
  }

  // ─── Snapshot cron — every 5 minutes ─────────────────────────────────────────

  @Cron('0 */5 * * * *')
  async snapshotPrices() {
    const activeAssets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE', asaId: { not: null } },
      select: { id: true, asaId: true, tinymanPoolAddress: true },
    });

    if (!activeAssets.length) return;

    const network: 'testnet' | 'mainnet' =
      this.config.get<string>('ALGORAND_NETWORK', 'testnet') === 'mainnet' ? 'mainnet' : 'testnet';

    for (const asset of activeAssets) {
      if (!asset.asaId || !asset.tinymanPoolAddress) continue;
      try {
        const asset1ID = Math.min(asset.asaId, this.usdcAsaId);
        const asset2ID = Math.max(asset.asaId, this.usdcAsaId);

        const poolInfo = await poolUtils.v2.getPoolInfo({
          client: this.tinymanAlgod,
          network,
          asset1ID,
          asset2ID,
        });
        const reserves = await poolUtils.v2.getPoolReserves(this.tinymanAlgod, poolInfo);

        if (!reserves.asset1 || !reserves.asset2) continue;

        // Use pool.asset1ID (SDK-returned ordering) — not numeric comparison.
        // Tinyman may register assets in a different order than Math.min/max predicts.
        const poolAsset1IsUsdc = (poolInfo as any).asset1ID === this.usdcAsaId;
        const usdcReserve = poolAsset1IsUsdc ? reserves.asset1 : reserves.asset2;
        const tokenReserve = poolAsset1IsUsdc ? reserves.asset2 : reserves.asset1;

        if (tokenReserve === 0n) continue;

        // Both reserves are in base units (6 decimals each); ratio gives price in USDC per token
        const price = Number(usdcReserve) / Number(tokenReserve);

        await this.prisma.priceSnapshot.create({
          data: { assetId: asset.id, asaId: asset.asaId, price },
        });
      } catch (err: any) {
        this.logger.warn(`Price snapshot failed for asset ${asset.id}: ${err.message}`);
      }
    }
  }

  // ─── Price history query ──────────────────────────────────────────────────────

  async getPriceHistory(assetId: string, range: '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL') {
    const now = new Date();
    const cutoff = new Date(now);
    switch (range) {
      case '1D': cutoff.setDate(now.getDate() - 1); break;
      case '1W': cutoff.setDate(now.getDate() - 7); break;
      case '1M': cutoff.setMonth(now.getMonth() - 1); break;
      case '3M': cutoff.setMonth(now.getMonth() - 3); break;
      case '1Y': cutoff.setFullYear(now.getFullYear() - 1); break;
      case 'ALL': cutoff.setFullYear(2000); break;
    }

    const rows = await this.prisma.priceSnapshot.findMany({
      where: { assetId, ts: { gte: cutoff } },
      orderBy: { ts: 'asc' },
      select: { price: true, ts: true },
    });

    return rows.map((r) => ({ price: r.price, ts: r.ts.toISOString() }));
  }

  // ─── Latest price + 24h change ────────────────────────────────────────────────

  async getLatestPrice(assetId: string) {
    const [latest, dayOld] = await Promise.all([
      this.prisma.priceSnapshot.findFirst({
        where: { assetId },
        orderBy: { ts: 'desc' },
        select: { price: true, ts: true },
      }),
      this.prisma.priceSnapshot.findFirst({
        where: { assetId, ts: { lte: new Date(Date.now() - 86_400_000) } },
        orderBy: { ts: 'desc' },
        select: { price: true },
      }),
    ]);

    if (latest) {
      const change24h = dayOld ? ((latest.price - dayOld.price) / dayOld.price) * 100 : 0;
      return { price: latest.price, ts: latest.ts.toISOString(), change24h };
    }

    // No snapshot yet — read live from pool reserves and persist a first snapshot
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, asaId: { not: null } },
      select: { asaId: true, tinymanPoolAddress: true },
    });
    if (!asset?.asaId) return null;

    try {
      const network: 'testnet' | 'mainnet' =
        this.config.get<string>('ALGORAND_NETWORK', 'testnet') === 'mainnet' ? 'mainnet' : 'testnet';
      const asset1ID = Math.min(asset.asaId, this.usdcAsaId);
      const asset2ID = Math.max(asset.asaId, this.usdcAsaId);
      const poolInfo = await poolUtils.v2.getPoolInfo({ client: this.tinymanAlgod, network, asset1ID, asset2ID });
      const reserves = await poolUtils.v2.getPoolReserves(this.tinymanAlgod, poolInfo);
      if (!reserves.asset1 || !reserves.asset2) return null;
      const poolAsset1IsUsdc = (poolInfo as any).asset1ID === this.usdcAsaId;
      const usdcReserve = poolAsset1IsUsdc ? reserves.asset1 : reserves.asset2;
      const tokenReserve = poolAsset1IsUsdc ? reserves.asset2 : reserves.asset1;
      if (tokenReserve === 0n) return null;
      const price = Number(usdcReserve) / Number(tokenReserve);
      const now = new Date();
      await this.prisma.priceSnapshot.create({ data: { assetId, asaId: asset.asaId, price, ts: now } });
      return { price, ts: now.toISOString(), change24h: 0 };
    } catch (err: any) {
      this.logger.warn(`Live price fallback failed for ${assetId}: ${err.message}`);
      return null;
    }
  }
}
