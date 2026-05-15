import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 5-stage verification pipeline:
// 1. Document review  2. Legal review  3. Valuation  4. Risk committee  5. Compliance sign-off

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getVerificationStatus(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, verificationStatus: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const logs = await this.prisma.assetVerificationLog.findMany({
      where: { assetId },
      orderBy: { createdAt: 'asc' },
    });

    return { assetId, verificationStatus: asset.verificationStatus, stages: logs };
  }

  async advanceStage(assetId: string, stage: number, result: string, reviewerId: string, notes?: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const log = await this.prisma.assetVerificationLog.create({
      data: { assetId, stage, status: result as any, reviewerId, notes },
    });

    // Stage 5 completion moves asset to APPROVED
    if (stage === 5 && result === 'APPROVED') {
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { verificationStatus: 'APPROVED' },
      });
      this.logger.log(`Asset ${assetId} fully approved through all 5 verification stages`);
    } else if (result === 'REJECTED') {
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { verificationStatus: 'REJECTED', status: 'REJECTED' },
      });
      this.logger.warn(`Asset ${assetId} rejected at stage ${stage}`);
    }

    return log;
  }

  async listPendingVerifications() {
    return this.prisma.asset.findMany({
      where: { verificationStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, ticker: true, category: true, issuerId: true, createdAt: true },
    });
  }
}
