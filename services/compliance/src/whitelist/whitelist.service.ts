import { Injectable, Logger } from '@nestjs/common';
import algosdk from 'algosdk';
import { WhitelistRepository } from './whitelist.repository';
import { EventProducerService } from '../events/event-producer.service';
import { AlgorandService } from '../algorand/algorand.service';
import { Topics } from '@chainstrike/events';
import { KycVerifiedPayload, WhitelistUpdatedPayload } from '@chainstrike/types';

@Injectable()
export class WhitelistService {
  private readonly logger = new Logger(WhitelistService.name);

  constructor(
    private readonly whitelistRepo: WhitelistRepository,
    private readonly events: EventProducerService,
    private readonly algorand: AlgorandService,
  ) {}

  // ─── Add address to whitelist ─────────────────────────────────────────────────
  // Triggered by: kyc.verified event (after investor KYC approval)
  // Two-phase: update DB first, then update on-chain whitelist contract.

  async addToWhitelist(
    walletAddress: string,
    assetId: string,
    asaId: number,
    userId: string,
    kycTier: number,
    expiresAt?: Date,
  ): Promise<void> {
    // Phase 1: Update off-chain record
    await this.whitelistRepo.upsert({
      walletAddress,
      assetId,
      asaId,
      userId,
      kycTier,
      isActive: true,
      expiresAt,
    });

    // Phase 2: Update on-chain Whitelist Registry Contract
    const txId = await this.algorand.updateWhitelistOnChain({
      action: 'add',
      walletAddress,
      asaId,
      kycTier,
      expiryTimestamp: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0,
    });

    // Record the on-chain TX ID
    await this.whitelistRepo.setOnChainTxId(walletAddress, assetId, txId);

    this.logger.log(`Whitelisted ${walletAddress} for asset ${asaId} (tier=${kycTier})`);

    // Emit event for audit trail
    await this.events.emit<WhitelistUpdatedPayload>(Topics.WHITELIST_UPDATED, {
      action: 'added',
      walletAddress,
      assetId,
      asaId,
      userId,
    });
  }

  // ─── Remove from whitelist ────────────────────────────────────────────────────
  // Triggered by: sanctions match, KYC expiry, account suspension

  async removeFromWhitelist(
    walletAddress: string,
    assetId: string,
    asaId: number,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.whitelistRepo.deactivate(walletAddress, assetId, reason);

    const txId = await this.algorand.updateWhitelistOnChain({
      action: 'remove',
      walletAddress,
      asaId,
      kycTier: 0,
    });

    this.logger.log(`Removed ${walletAddress} from whitelist for asset ${asaId}: ${reason}`);

    await this.events.emit<WhitelistUpdatedPayload>(Topics.WHITELIST_UPDATED, {
      action: 'removed',
      walletAddress,
      assetId,
      asaId,
      userId,
      reason,
    });
  }

  // ─── Handle KYC Verified event ────────────────────────────────────────────────
  // When investor completes KYC, add them to all eligible asset whitelists

  async handleKycVerified(payload: KycVerifiedPayload): Promise<void> {
    if (!payload.walletAddress) return; // Wallet not connected yet — handled when wallet connects

    // Get all active assets this investor qualifies for based on KYC tier and jurisdiction
    const eligibleAssets = await this.whitelistRepo.findEligibleAssets(
      payload.tier,
      payload.jurisdiction,
    );

    for (const asset of eligibleAssets) {
      await this.addToWhitelist(
        payload.walletAddress,
        asset.id,
        asset.asaId,
        payload.userId,
        payload.tier,
        new Date(payload.expiresAt),
      );
    }
  }

  async getWhitelistForWallet(walletAddress: string) {
    return this.whitelistRepo.findByWallet(walletAddress);
  }

  async isWhitelisted(walletAddress: string, asaId: number): Promise<boolean> {
    const entry = await this.whitelistRepo.findByAddressAndAsaId(walletAddress, asaId);
    if (!entry || !entry.isActive) return false;
    if (entry.expiresAt && entry.expiresAt < new Date()) return false;
    return true;
  }

  async handleKycExpired(userId: string, walletAddresses: string[]): Promise<void> {
    for (const addr of walletAddresses) {
      await this.whitelistRepo.removeAllForWallet(addr, 'KYC expired');
    }
  }

  async removeAllForWallet(walletAddress: string, reason: string): Promise<void> {
    await this.whitelistRepo.removeAllForWallet(walletAddress, reason);
  }

  // ─── Dev-only: instantly approve a wallet (testnet use only) ─────────────────

  async devApproveWallet(
    walletAddress: string,
    asaId: number,
    assetId: string,
    userId: string,
  ): Promise<{ whitelisted: boolean }> {
    await this.whitelistRepo.upsert({
      walletAddress,
      assetId,
      asaId,
      userId,
      kycTier: 1,
      isActive: true,
      expiresAt: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
    });
    this.logger.warn(`[DEV] Auto-whitelisted ${walletAddress} for ASA ${asaId}`);
    return { whitelisted: true };
  }

  // ─── Expire overdue whitelist entries (daily job) ─────────────────────────────

  async processExpiredEntries(): Promise<void> {
    const expired = await this.whitelistRepo.findExpiredActive();
    for (const entry of expired) {
      await this.removeFromWhitelist(
        entry.walletAddress,
        entry.assetId,
        entry.asaId,
        entry.userId,
        'KYC tier expired',
      );
    }
  }
}
