import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AssetRepository } from './asset.repository';
import { AlgorandAssetService } from '../algorand/algorand-asset.service';
import { EventProducerService } from '../events/event-producer.service';
import { Topics } from '@chainstrike/events';
import { AssetCategory } from '@chainstrike/types';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    private readonly assetRepo: AssetRepository,
    private readonly algorandAsset: AlgorandAssetService,
    private readonly events: EventProducerService,
  ) {}

  // ─── Create asset application (Phase 4 — Stage 1) ────────────────────────────

  async createAsset(issuerId: string, dto: CreateAssetDto) {
    // Validate ticker uniqueness
    const existing = await this.assetRepo.findByTicker(dto.ticker.toUpperCase());
    if (existing) throw new BadRequestException(`Ticker ${dto.ticker} already taken`);

    const asset = await this.assetRepo.create({
      issuerId,
      ...dto,
      ticker: dto.ticker.toUpperCase(),
      status: 'SUBMITTED',
      verificationStatus: 'PENDING',
    });

    this.logger.log(`Asset application submitted: ${asset.id} by issuer ${issuerId}`);
    return asset;
  }

  // ─── Deploy ASA (Phase 4 — Stage 5, after verification approval) ─────────────
  // Called by Admin after risk committee approval.
  // Creates the ASA on Algorand with all compliance configuration.

  async deployAsaToMainnet(assetId: string, adminUserId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('Asset must be verified before ASA deployment');
    }
    if (asset.asaId) {
      throw new BadRequestException('ASA already deployed');
    }

    // Prepare metadata hash for on-chain commitment
    const metadataHash = this.computeMetadataHash(asset);

    // Deploy ASA via Algorand service
    const { asaId, complianceContractId } = await this.algorandAsset.createRwaToken({
      name: asset.name,
      ticker: asset.ticker,
      totalSupply: asset.totalSupply,
      decimals: asset.decimals,
      metadataHash,
      lockupDays: asset.lockupDays,
      minimumKycTier: asset.minimumKycTier,
      totalSupplyBigInt: asset.totalSupply,
    });

    // Update asset record with on-chain IDs
    await this.assetRepo.update(assetId, {
      asaId,
      complianceContractId,
      status: 'PRE_MARKET',
    });

    this.logger.log(`ASA deployed: asaId=${asaId} for asset ${assetId}`);

    // Emit event so Orderbook Service opens a market
    await this.events.emit(Topics.ASSET_CREATED, {
      assetId,
      issuerId: asset.issuerId,
      asaId,
      ticker: asset.ticker,
      complianceContractId,
    });

    return { assetId, asaId, complianceContractId };
  }

  // ─── Approve asset for trading (Admin action) ─────────────────────────────────

  async approveVerification(assetId: string, reviewerId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    await this.assetRepo.update(assetId, { verificationStatus: 'APPROVED' });
    await this.assetRepo.addVerificationLog(assetId, 5, 'APPROVED', reviewerId);

    return { assetId, verificationStatus: 'APPROVED' };
  }

  // ─── Activate market (after initial liquidity placed) ────────────────────────

  async activateMarket(assetId: string, adminUserId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status !== 'PRE_MARKET') {
      throw new BadRequestException(`Asset must be in PRE_MARKET status, current: ${asset.status}`);
    }

    await this.assetRepo.update(assetId, { status: 'ACTIVE', listedAt: new Date() });

    await this.events.emit(Topics.ASSET_STATUS_CHANGED, {
      assetId,
      asaId: asset.asaId ?? 0,
      previousStatus: 'PRE_MARKET',
      newStatus: 'ACTIVE',
    });

    this.logger.log(`Market ACTIVATED for asset ${assetId}`);
    return { assetId, status: 'ACTIVE' };
  }

  async findAll(filters: { category?: string; status?: string }) {
    return this.assetRepo.findAll(filters);
  }

  async findById(id: string) {
    const asset = await this.assetRepo.findById(id);
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async findByIssuer(issuerId: string) {
    return this.assetRepo.findByIssuerId(issuerId);
  }

  private computeMetadataHash(asset: { id: string; name: string; ticker: string }): Buffer {
    const data = JSON.stringify({ id: asset.id, name: asset.name, ticker: asset.ticker });
    return createHash('sha256').update(data).digest();
  }
}
