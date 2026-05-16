import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type SettlementStatus = 'PENDING' | 'AWAITING_SIGNATURES' | 'SUBMITTING' | 'CONFIRMING' | 'SETTLED' | 'FAILED' | 'CANCELLED';

@Injectable()
export class SettlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    tradeId: string;
    asaId: number;
    assetId: string;
    buyerUserId: string;
    sellerUserId: string;
    buyerWalletAddress: string;
    sellerWalletAddress: string;
    tokenAmount: bigint;
    usdcAmount: bigint;
    platformFee: bigint;
    status: SettlementStatus;
  }) {
    return this.prisma.settlement.create({ data });
  }

  async findById(id: string) {
    return this.prisma.settlement.findUnique({ where: { id } });
  }

  async findByTradeId(tradeId: string) {
    return this.prisma.settlement.findUnique({ where: { tradeId } });
  }

  async updateStatus(id: string, status: SettlementStatus, failureReason?: string, onChainTxId?: string) {
    const data: Record<string, unknown> = { status };
    if (failureReason !== undefined) data.failureReason = failureReason;
    if (onChainTxId !== undefined) data.onChainTxId = onChainTxId;
    if (status === 'SETTLED') data.settledAt = new Date();
    return this.prisma.settlement.update({ where: { id }, data });
  }

  async setConfirmedRound(id: string, confirmedRound: number) {
    return this.prisma.settlement.update({
      where: { id },
      data: { confirmedRound },
    });
  }

  async addLog(settlementId: string, attempt: number, action: string, txId?: string, error?: string) {
    return this.prisma.settlementLog.create({
      data: {
        settlementId,
        attempt,
        action,
        txId: txId ?? null,
        error: error ?? null,
      },
    });
  }

  async findPending() {
    return this.prisma.settlement.findMany({
      where: { status: { in: ['PENDING', 'AWAITING_SIGNATURES'] } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
