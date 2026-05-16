import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AmlService {
  private readonly logger = new Logger(AmlService.name);
  private readonly chainalysisBaseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.chainalysisBaseUrl = this.config.get<string>('CHAINALYSIS_API_URL', 'https://api.chainalysis.com');
    this.apiKey = this.config.getOrThrow<string>('CHAINALYSIS_API_KEY');
  }

  // Screen wallet via Chainalysis KYT (Know Your Transaction)
  async screenWallet(walletAddress: string, userId: string): Promise<{
    riskScore: number;
    riskBand: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
    sanctionsMatch: boolean;
  }> {
    try {
      const response = await axios.get(
        `${this.chainalysisBaseUrl}/v1/addresses/${walletAddress}/exposures`,
        { headers: { Token: this.apiKey } },
      );

      const data = response.data;
      const riskScore: number = data.risk?.score ?? 0;
      const riskBand = this.classifyRisk(riskScore);
      const sanctionsMatch = data.identifications?.some(
        (i: { category: string }) => i.category === 'sanctions',
      ) ?? false;

      await this.prisma.walletRiskScore.upsert({
        where: { walletAddress },
        create: {
          walletAddress,
          score: riskScore,
          riskBand,
          provider: 'chainalysis',
          exposures: sanctionsMatch ? 'sanctions' : '',
          lastCheckedAt: new Date(),
        },
        update: {
          score: riskScore,
          riskBand,
          exposures: sanctionsMatch ? 'sanctions' : '',
          lastCheckedAt: new Date(),
        },
      });

      if (sanctionsMatch || riskBand === 'SEVERE') {
        await this.raiseSanctionsAlert(walletAddress, userId, riskScore);
      }

      return { riskScore, riskBand, sanctionsMatch };
    } catch (err) {
      this.logger.error(`Chainalysis screening failed for ${walletAddress}: ${err}`);
      // Fail-open with HIGH risk so compliance team reviews manually
      return { riskScore: 75, riskBand: 'HIGH', sanctionsMatch: false };
    }
  }

  async screenTransaction(txnId: string, fromAddress: string, toAddress: string, amountUsdc: bigint) {
    // Post-trade AML transaction screening
    try {
      const response = await axios.post(
        `${this.chainalysisBaseUrl}/v1/transfers`,
        {
          asset: 'USDC',
          network: 'ALGO',
          transferReference: txnId,
          outputAddress: toAddress,
          value: Number(amountUsdc) / 1_000_000,
        },
        { headers: { Token: this.apiKey } },
      );

      const alert = response.data?.alert;
      if (alert) {
        await this.prisma.amlAlert.create({
          data: {
            alertType: 'TRANSACTION_MONITORING',
            severity: alert.severity ?? 'MEDIUM',
            walletAddress: fromAddress,
            tradeId: txnId,
            description: alert.reason ?? 'Transaction flagged by Chainalysis KYT',
          },
        });
      }
    } catch (err) {
      this.logger.error(`Transaction screening error: ${err}`);
    }
  }

  private async raiseSanctionsAlert(walletAddress: string, userId: string, score: number) {
    await this.prisma.amlAlert.create({
      data: {
        alertType: 'SANCTIONS_MATCH',
        severity: 'CRITICAL',
        walletAddress,
        description: `Sanctions/severe risk detected. Score: ${score}`,
        status: 'OPEN',
      },
    });

    this.logger.warn(`SANCTIONS ALERT raised for wallet ${walletAddress} userId=${userId} — account freeze skipped (Kafka disabled)`);
  }

  private classifyRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE' {
    if (score < 25) return 'LOW';
    if (score < 50) return 'MEDIUM';
    if (score < 75) return 'HIGH';
    return 'SEVERE';
  }

  async getOpenAlerts(limit = 50) {
    return this.prisma.amlAlert.findMany({
      where: { status: 'OPEN' },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: limit,
    });
  }

  async resolveAlert(alertId: string, resolverId: string, disposition: string, notes: string) {
    return this.prisma.amlAlert.update({
      where: { id: alertId },
      data: {
        status: 'CLEARED',
        reviewedBy: resolverId,
        reviewedAt: new Date(),
        resolution: notes,
      },
    });
  }
}
