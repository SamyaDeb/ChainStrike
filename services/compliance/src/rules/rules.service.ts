import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConstants } from '@chainstrike/config';

interface PreTradeCheckInput {
  buyerWallet: string;
  assetId: number;           // Algorand ASA ID (asaId)
  quantity: bigint;
  price: bigint;
  buyerKycTier: number;
  buyerAnnualVolume: bigint;
}

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkPreTrade(input: PreTradeCheckInput): Promise<{ approved: boolean; failureCode?: string }> {
    // 1. Whitelist check — order placer must be whitelisted for this asset
    const buyerWhitelisted = await this.prisma.whitelistEntry.findFirst({
      where: { walletAddress: input.buyerWallet, asaId: input.assetId, isActive: true },
    });
    if (!buyerWhitelisted) {
      return { approved: false, failureCode: 'BUYER_NOT_WHITELISTED' };
    }
    if (buyerWhitelisted.expiresAt && buyerWhitelisted.expiresAt < new Date()) {
      return { approved: false, failureCode: 'BUYER_WHITELIST_EXPIRED' };
    }

    // 2. KYC tier volume limits
    const tradeValueUsdc = (input.quantity * input.price) / 1_000_000n;
    const annualLimitExceeded = this.checkAnnualLimit(input.buyerKycTier, input.buyerAnnualVolume + tradeValueUsdc);
    if (annualLimitExceeded) {
      return { approved: false, failureCode: 'ANNUAL_LIMIT_EXCEEDED' };
    }

    // 3. Asset-level transfer rules
    const rules = await this.prisma.transferRule.findMany({
      where: { assetId: buyerWhitelisted.assetId, isActive: true },
    });

    for (const rule of rules) {
      const violation = this.evaluateRule(rule, input);
      if (violation) return { approved: false, failureCode: violation };
    }

    return { approved: true };
  }

  private checkAnnualLimit(tier: number, cumulativeUsdc: bigint): boolean {
    if (tier === 1) return cumulativeUsdc > PlatformConstants.TIER1_ANNUAL_LIMIT;
    if (tier === 2) return cumulativeUsdc > PlatformConstants.TIER2_ANNUAL_LIMIT;
    return false; // Tier 3 = unlimited
  }

  private evaluateRule(rule: { ruleType: string; value: unknown }, input: PreTradeCheckInput): string | null {
    const params = rule.value as Record<string, unknown>;
    switch (rule.ruleType) {
      case 'MIN_INVESTMENT':
        if (input.quantity * input.price < BigInt(params['minUsdc'] as string)) {
          return 'BELOW_MINIMUM_INVESTMENT';
        }
        break;
      case 'MAX_SINGLE_INVESTOR':
        // Would require checking current holdings — simplified here
        break;
      case 'LOCKUP_PERIOD':
        // Enforced on-chain by TransferRestriction contract
        break;
    }
    return null;
  }

  async createRule(assetId: string, ruleType: string, value: Record<string, unknown>, createdBy: string) {
    return this.prisma.transferRule.create({
      data: { assetId, ruleType, value: value as any, isActive: true, createdBy },
    });
  }
}
