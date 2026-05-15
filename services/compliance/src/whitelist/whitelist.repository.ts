import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhitelistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: {
    walletAddress: string;
    assetId: string;
    asaId: number;
    userId: string;
    kycTier: number;
    isActive: boolean;
    expiresAt?: Date;
  }) {
    return this.prisma.whitelistEntry.upsert({
      where: { walletAddress_assetId: { walletAddress: data.walletAddress, assetId: data.assetId } },
      create: data,
      update: {
        asaId: data.asaId,
        userId: data.userId,
        kycTier: data.kycTier,
        isActive: data.isActive,
        expiresAt: data.expiresAt,
        removedAt: null,
        removedReason: null,
      },
    });
  }

  async setOnChainTxId(walletAddress: string, assetId: string, onChainTxId: string | null) {
    if (!onChainTxId) return null;
    return this.prisma.whitelistEntry.update({
      where: { walletAddress_assetId: { walletAddress, assetId } },
      data: { onChainTxId },
    });
  }

  async deactivate(walletAddress: string, assetId: string, reason: string) {
    return this.prisma.whitelistEntry.update({
      where: { walletAddress_assetId: { walletAddress, assetId } },
      data: { isActive: false, removedReason: reason, removedAt: new Date() },
    });
  }

  async remove(walletAddress: string, assetId: string, reason: string) {
    return this.deactivate(walletAddress, assetId, reason);
  }

  async findByWallet(walletAddress: string) {
    return this.prisma.whitelistEntry.findMany({ where: { walletAddress, isActive: true } });
  }

  async findByAsset(assetId: string) {
    return this.prisma.whitelistEntry.findMany({
      where: { assetId, isActive: true },
      orderBy: { addedAt: 'desc' },
    });
  }

  async isApproved(walletAddress: string, assetId: string): Promise<boolean> {
    const entry = await this.prisma.whitelistEntry.findUnique({
      where: { walletAddress_assetId: { walletAddress, assetId } },
      select: { isActive: true, expiresAt: true },
    });
    if (!entry || !entry.isActive) return false;
    if (!entry.expiresAt) return true;
    return entry.expiresAt > new Date();
  }

  async findByAddressAndAsaId(walletAddress: string, asaId: number) {
    return this.prisma.whitelistEntry.findFirst({
      where: { walletAddress, asaId },
      orderBy: { addedAt: 'desc' },
    });
  }

  async findEligibleAssets(kycTier: number, _jurisdiction?: string) {
    return this.prisma.whitelistEntry.findMany({
      where: { isActive: true, kycTier: { lte: kycTier } },
      select: { assetId: true, asaId: true },
      distinct: ['assetId'],
    }).then((rows) => rows.map((r) => ({ id: r.assetId, asaId: r.asaId })));
  }

  async findExpiredEntries() {
    return this.prisma.whitelistEntry.findMany({
      where: { isActive: true, expiresAt: { lt: new Date() } },
    });
  }

  async findExpiredActive() {
    return this.findExpiredEntries();
  }

  async removeAllForWallet(walletAddress: string, reason: string) {
    return this.prisma.whitelistEntry.updateMany({
      where: { walletAddress, isActive: true },
      data: { isActive: false, removedReason: reason, removedAt: new Date() },
    });
  }
}
