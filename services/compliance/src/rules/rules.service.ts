import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConstants } from '@chainstrike/config';
import { queryWhitelistOnChain } from '@chainstrike/algorand';
import algosdk from 'algosdk';

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
  private readonly algodClient: algosdk.Algodv2;
  private readonly whitelistRegistryAppId: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'https://testnet-api.algonode.cloud'),
      this.config.get<string>('ALGORAND_ALGOD_PORT', '443'),
    );
    this.whitelistRegistryAppId = parseInt(
      this.config.get<string>('WHITELIST_REGISTRY_APP_ID', '762425821'), 10,
    );
  }

  async checkPreTrade(input: PreTradeCheckInput): Promise<{ approved: boolean; failureCode?: string }> {
    // Dev bypass — skip all compliance checks when DEV_SKIP_COMPLIANCE=true
    if (process.env['DEV_SKIP_COMPLIANCE'] === 'true') {
      this.logger.warn(`[DEV] Skipping compliance checks for ${input.buyerWallet}`);
      return { approved: true };
    }

    // 1. On-chain whitelist check via WhitelistRegistry contract box storage
    let onChainTier = input.buyerKycTier;
    try {
      const result = await queryWhitelistOnChain(
        this.algodClient,
        this.whitelistRegistryAppId,
        input.buyerWallet,
        input.assetId,
      );

      if (!result.isWhitelisted) {
        // Fall back to DB if on-chain says not whitelisted (may not be added yet)
        const dbEntry = await this.prisma.whitelistEntry.findFirst({
          where: { walletAddress: input.buyerWallet, asaId: input.assetId, isActive: true },
        });
        if (!dbEntry) {
          return { approved: false, failureCode: 'BUYER_NOT_WHITELISTED' };
        }
        if (dbEntry.expiresAt && dbEntry.expiresAt < new Date()) {
          return { approved: false, failureCode: 'BUYER_WHITELIST_EXPIRED' };
        }
        onChainTier = dbEntry.kycTier;
      } else {
        if (result.expiresAt && result.expiresAt < new Date()) {
          return { approved: false, failureCode: 'BUYER_WHITELIST_EXPIRED' };
        }
        onChainTier = result.tier || input.buyerKycTier;
      }
    } catch (err) {
      // On algod failure, fall back to DB
      this.logger.warn(`On-chain whitelist query failed, falling back to DB: ${(err as Error).message}`);
      const dbEntry = await this.prisma.whitelistEntry.findFirst({
        where: { walletAddress: input.buyerWallet, asaId: input.assetId, isActive: true },
      });
      if (!dbEntry) {
        return { approved: false, failureCode: 'BUYER_NOT_WHITELISTED' };
      }
      if (dbEntry.expiresAt && dbEntry.expiresAt < new Date()) {
        return { approved: false, failureCode: 'BUYER_WHITELIST_EXPIRED' };
      }
      onChainTier = dbEntry.kycTier;
    }

    // 2. KYC tier volume limits
    const tradeValueUsdc = (input.quantity * input.price) / 1_000_000n;
    const annualLimitExceeded = this.checkAnnualLimit(onChainTier, input.buyerAnnualVolume + tradeValueUsdc);
    if (annualLimitExceeded) {
      return { approved: false, failureCode: 'ANNUAL_LIMIT_EXCEEDED' };
    }

    // 3. Asset-level transfer rules from DB
    const rules = await this.prisma.transferRule.findMany({
      where: { assetId: input.assetId.toString(), isActive: true },
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
    let params: Record<string, unknown>;
    try {
      params = typeof rule.value === 'string' ? JSON.parse(rule.value) : (rule.value as Record<string, unknown>);
    } catch {
      return null;
    }
    switch (rule.ruleType) {
      case 'MIN_INVESTMENT':
        if (input.quantity * input.price < BigInt(params['minUsdc'] as string)) {
          return 'BELOW_MINIMUM_INVESTMENT';
        }
        break;
      case 'MAX_SINGLE_INVESTOR':
        break;
      case 'LOCKUP_PERIOD':
        break;
    }
    return null;
  }

  async createRule(assetId: string, ruleType: string, value: Record<string, unknown>, createdBy: string) {
    return this.prisma.transferRule.create({
      data: { assetId, ruleType, value: JSON.stringify(value), isActive: true, createdBy },
    });
  }
}
