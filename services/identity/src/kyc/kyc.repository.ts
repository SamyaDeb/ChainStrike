import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KycRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    jurisdiction: string;
    sumsubApplicantId?: string;
  }) {
    return this.prisma.kycProfile.create({ data });
  }

  async findByUserId(userId: string) {
    return this.prisma.kycProfile.findFirst({ where: { userId } });
  }

  async findBySumsubApplicantId(applicantId: string) {
    return this.prisma.kycProfile.findFirst({
      where: { sumsubApplicantId: applicantId },
    });
  }

  async update(
    id: string,
    data: Partial<{
      status: string;
      tier: number;
      riskBand: string;
      expiresAt: Date;
      approvedAt: Date;
      rejectionReason: string | undefined;
      sumsubInspectionId: string;
      sumsubApplicantId: string;
      jurisdiction: string;
    }>,
  ) {
    return this.prisma.kycProfile.update({ where: { id }, data: data as any });
  }

  // Finds all APPROVED profiles whose expiry has passed — for the daily expiry job
  async findExpiredApproved() {
    return this.prisma.kycProfile.findMany({
      where: {
        status: 'APPROVED',
        expiresAt: { lt: new Date() },
      },
    });
  }
}
