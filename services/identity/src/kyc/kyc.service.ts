import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SumsubService } from '../sumsub/sumsub.service';
import { KycRepository } from './kyc.repository';
import { EventProducerService } from '../events/event-producer.service';
import { Topics } from '@chainstrike/events';
import { SumsubWebhookPayload } from '@chainstrike/types';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly sumsubService: SumsubService,
    private readonly kycRepo: KycRepository,
    private readonly events: EventProducerService,
  ) {}

  // ─── Initiate KYC ────────────────────────────────────────────────────────────
  // Creates a Sumsub applicant and returns an SDK access token.
  // The frontend embeds the Sumsub WebSDK using this token.
  // PII (documents, biometrics) goes directly to Sumsub — never through our servers.

  async initiate(userId: string, jurisdiction: string) {
    const existing = await this.kycRepo.findByUserId(userId);
    if (existing?.status === 'APPROVED') {
      throw new BadRequestException('KYC already approved');
    }

    const levelName = 'basic-kyc-level'; // configured in Sumsub dashboard
    const applicantId = await this.sumsubService.createApplicant(userId, levelName, jurisdiction);

    if (!existing) {
      await this.kycRepo.create({ userId, jurisdiction, sumsubApplicantId: applicantId });
    } else {
      await this.kycRepo.update(existing.id, {
        sumsubApplicantId: applicantId,
        status: 'PENDING',
        jurisdiction,
      });
    }

    // Generate short-lived SDK access token (expires in 10 minutes)
    const sdkToken = await this.sumsubService.generateAccessToken(applicantId, userId, levelName);
    return { applicantId, sdkToken };
  }

  // ─── Handle Sumsub Webhook ────────────────────────────────────────────────────
  // Sumsub POSTs to this endpoint when verification completes.
  // Webhook payload contains NO PII — only status and IDs.

  async handleWebhook(payload: SumsubWebhookPayload): Promise<void> {
    this.logger.log(`Sumsub webhook: ${payload.type} for applicant ${payload.applicantId}`);

    if (payload.type !== 'applicantReviewed') return;

    const profile = await this.kycRepo.findBySumsubApplicantId(payload.applicantId);
    if (!profile) {
      this.logger.warn(`No KYC profile found for applicant ${payload.applicantId}`);
      return;
    }

    const reviewResult = payload.reviewResult;
    if (!reviewResult) return;

    if (reviewResult.reviewAnswer === 'GREEN') {
      // Approved — calculate tier based on level and determine expiry
      const tier = await this.resolveTier(payload.applicantId);
      const expiresAt = this.calculateExpiry(tier);

      await this.kycRepo.update(profile.id, {
        status: 'APPROVED',
        tier,
        expiresAt,
        approvedAt: new Date(),
        sumsubInspectionId: payload.inspectionId,
        rejectionReason: undefined,
      });

      this.logger.log(`KYC approved: user=${profile.userId}, tier=${tier}`);

      // Emit event so Compliance Service can whitelist the user's wallet address
      await this.events.emit(Topics.KYC_VERIFIED, {
        userId: profile.userId,
        walletAddress: '', // Filled in after wallet is connected; Compliance listens for wallet events too
        tier,
        jurisdiction: profile.jurisdiction,
        expiresAt: expiresAt.toISOString(),
      });
    } else {
      const reason = reviewResult.rejectLabels?.join(', ') ?? 'Verification failed';
      await this.kycRepo.update(profile.id, {
        status: reviewResult.reviewRejectType === 'RETRY' ? 'PENDING' : 'REJECTED',
        rejectionReason: reason,
      });

      if (reviewResult.reviewRejectType === 'FINAL') {
        await this.events.emit(Topics.KYC_REJECTED, {
          userId: profile.userId,
          reason,
        });
      }
    }
  }

  // ─── Check and expire overdue KYC ────────────────────────────────────────────
  // Called by a scheduled job daily to expire KYC and emit events.

  async processExpiredProfiles(): Promise<void> {
    const expired = await this.kycRepo.findExpiredApproved();
    for (const profile of expired) {
      await this.kycRepo.update(profile.id, { status: 'EXPIRED' });
      await this.events.emit(Topics.KYC_EXPIRED, {
        userId: profile.userId,
        walletAddress: '',
        previousTier: profile.tier as 0 | 1 | 2 | 3,
      });
      this.logger.log(`KYC expired: user=${profile.userId}`);
    }
  }

  async getProfile(userId: string) {
    const profile = await this.kycRepo.findByUserId(userId);
    if (!profile) throw new NotFoundException('KYC profile not found');
    // Strip sensitive fields before returning to user
    return {
      id: profile.id,
      tier: profile.tier,
      status: profile.status,
      jurisdiction: profile.jurisdiction,
      approvedAt: profile.approvedAt,
      expiresAt: profile.expiresAt,
    };
  }

  private async resolveTier(applicantId: string): Promise<1 | 2 | 3> {
    // In production: call Sumsub API to check which level completed
    // For MVP: derive tier from level name configured in Sumsub dashboard
    const level = await this.sumsubService.getApplicantLevel(applicantId);
    if (level.includes('tier3') || level.includes('institutional')) return 3;
    if (level.includes('tier2') || level.includes('accredited')) return 2;
    return 1;
  }

  private calculateExpiry(tier: number): Date {
    const daysMap: Record<number, number> = { 1: 730, 2: 365, 3: 365 };
    const days = daysMap[tier] ?? 730;
    return new Date(Date.now() + days * 86_400_000);
  }
}
