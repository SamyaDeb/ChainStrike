import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface PreTradeInput {
  userId: string;
  walletAddress: string;
  assetId: string;
  asaId: number;
  side: string;
  price?: bigint;
  quantity: bigint;
  kycTier: number;
}

@Injectable()
export class ComplianceCheckService {
  private readonly logger = new Logger(ComplianceCheckService.name);
  private readonly complianceServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.complianceServiceUrl = this.config.get<string>(
      'COMPLIANCE_SERVICE_URL',
      'http://localhost:3004',
    );
  }

  async runPreTradeChecks(input: PreTradeInput): Promise<{
    approved: boolean;
    failureCode?: string;
  }> {
    if (process.env['DEV_SKIP_COMPLIANCE'] === 'true') {
      this.logger.warn(`DEV_SKIP_COMPLIANCE: pre-trade check bypassed for ${input.walletAddress}`);
      return { approved: true };
    }

    try {
      const response = await axios.post(
        `${this.complianceServiceUrl}/compliance/pre-trade`,
        {
          walletAddress: input.walletAddress,
          assetId: input.asaId,
          side: input.side,
          quantity: input.quantity.toString(),
          price: input.price?.toString(),
          kycTier: input.kycTier,
        },
        { timeout: 2000 },
      );
      return response.data;
    } catch (err) {
      // On compliance service timeout/error, reject the order (fail-safe)
      this.logger.error(`Compliance check failed for ${input.walletAddress}: ${err}`);
      return { approved: false, failureCode: 'COMPLIANCE_SERVICE_UNAVAILABLE' };
    }
  }
}
