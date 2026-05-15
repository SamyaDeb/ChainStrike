import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KybRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    issuerId: string;
    legalName: string;
    businessType: string;
    registrationNumber: string;
    incorporationJurisdiction: string;
    incorporationDate: Date;
    registeredAddress: Record<string, unknown>;
    primaryBusinessActivity: string;
    website?: string;
  }) {
    return this.prisma.kybEntity.create({ data: data as any });
  }

  async findByIssuerId(issuerId: string) {
    return this.prisma.kybEntity.findUnique({ where: { issuerId } });
  }

  async findById(id: string) {
    return this.prisma.kybEntity.findUnique({ where: { id } });
  }

  async updateStatus(id: string, status: string, updates?: Record<string, unknown>) {
    return this.prisma.kybEntity.update({
      where: { id },
      data: { status: status as any, ...updates, updatedAt: new Date() },
    });
  }

  async findPending() {
    return this.prisma.kybEntity.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }
}
