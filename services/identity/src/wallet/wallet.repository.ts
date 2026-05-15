import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, address: string, network: string) {
    return this.prisma.walletAddress.upsert({
      where: { address },
      update: { userId, network, verifiedAt: new Date() },
      create: { userId, address, network, verifiedAt: new Date() },
    });
  }

  async findByAddress(address: string) {
    return this.prisma.walletAddress.findFirst({
      where: { address, deletedAt: null },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.walletAddress.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPrimaryByUserId(userId: string) {
    return this.prisma.walletAddress.findFirst({
      where: { userId, isPrimary: true, deletedAt: null },
    });
  }
}
