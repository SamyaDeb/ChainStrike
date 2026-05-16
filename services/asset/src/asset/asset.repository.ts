import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    issuerId: string;
    name: string;
    ticker: string;
    category: string;
    description: string;
    totalSupply: bigint;
    decimals: number;
    pricePerToken: bigint;
    lockupDays?: number;
    minimumKycTier?: number;
    status: string;
    verificationStatus: string;
    initialLiquidityTxId?: string;
    liquidityDepositUsdc?: bigint;
    liquidityDepositTxId?: string;
    issuerWalletAddress?: string;
    issuanceEscrowTxId?: string;
    issuanceEscrowAmount?: bigint;
    issuanceEscrowStatus?: string;
  }) {
    return this.prisma.asset.create({ data: data as any });
  }

  async findById(id: string) {
    return this.prisma.asset.findUnique({ where: { id } });
  }

  async findByTicker(ticker: string) {
    return this.prisma.asset.findUnique({ where: { ticker } });
  }

  async findByIssuerId(issuerId: string) {
    return this.prisma.asset.findMany({
      where: { issuerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(filters: { category?: string; status?: string }) {
    const statuses = filters.status ? filters.status.split(',').map((s) => s.trim()).filter(Boolean) : null;
    return this.prisma.asset.findMany({
      where: {
        ...(filters.category ? { category: filters.category as any } : {}),
        ...(statuses ? { status: { in: statuses as any[] } } : {}),
      },
      include: { verificationLogs: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.asset.update({ where: { id }, data });
  }

  async addVerificationLog(assetId: string, stage: number, status: string, reviewerId: string, notes?: string) {
    return this.prisma.assetVerificationLog.create({
      data: { assetId, stage, status: status as any, reviewerId, ...(notes ? { notes } : {}) },
    });
  }

  async findByIdWithDocuments(id: string) {
    return this.prisma.asset.findUnique({
      where: { id },
      include: {
        documents: { select: { id: true, type: true, fileName: true, documentHash: true, createdAt: true } },
        verificationLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
  }
}
