import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    walletAddress: string;
    marketId: string;
    side: string;
    type: string;
    timeInForce: string;
    price?: bigint;
    quantity: bigint;
    remainingQuantity: bigint;
    filledQuantity: bigint;
    status: string;
    escrowTxId?: string;
  }) {
    return this.prisma.order.create({ data: data as any });
  }

  async findById(id: string) {
    return this.prisma.order.findUnique({ where: { id } });
  }

  async updateStatus(id: string, status: string, updates?: Record<string, unknown>) {
    return this.prisma.order.update({
      where: { id },
      data: { status: status as any, ...updates, updatedAt: new Date() },
    });
  }

  async findActiveByUser(userId: string) {
    return this.prisma.order.findMany({
      where: { userId, status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByMarket(marketId: string, limit = 100) {
    return this.prisma.order.findMany({
      where: { marketId, status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getMarket(assetId: string) {
    return this.prisma.market.findUnique({ where: { assetId } });
  }
}
