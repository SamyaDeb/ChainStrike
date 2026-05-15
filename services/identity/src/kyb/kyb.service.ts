import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { KybRepository } from './kyb.repository';
import { UserRepository } from '../user/user.repository';
import { EventProducerService } from '../events/event-producer.service';
import { Topics } from '@chainstrike/events';

@Injectable()
export class KybService {
  private readonly logger = new Logger(KybService.name);

  constructor(
    private readonly kybRepo: KybRepository,
    private readonly userRepo: UserRepository,
    private readonly events: EventProducerService,
  ) {}

  async submitKyb(issuerId: string, dto: {
    legalName: string;
    businessType: string;
    registrationNumber: string;
    incorporationJurisdiction: string;
    incorporationDate: Date;
    registeredAddress: Record<string, unknown>;
    primaryBusinessActivity: string;
    website?: string;
  }) {
    const existing = await this.kybRepo.findByIssuerId(issuerId);
    if (existing) {
      throw new BadRequestException('KYB already submitted for this issuer');
    }

    const kyb = await this.kybRepo.create({
      issuerId,
      ...dto,
    });

    this.logger.log(`KYB submitted: ${kyb.id} by issuer ${issuerId}`);
    return kyb;
  }

  async getKybStatus(issuerId: string) {
    const kyb = await this.kybRepo.findByIssuerId(issuerId);
    if (!kyb) return { status: 'NOT_SUBMITTED' };
    return {
      status: kyb.status,
      riskRating: kyb.riskRating,
      submittedAt: kyb.createdAt,
      approvedAt: kyb.approvedAt,
    };
  }

  async approveKyb(kybId: string, adminUserId: string) {
    const kyb = await this.kybRepo.findById(kybId);
    if (!kyb) throw new NotFoundException('KYB not found');
    if (kyb.status !== 'PENDING') {
      throw new BadRequestException(`KYB is ${kyb.status}, cannot approve`);
    }

    await this.kybRepo.updateStatus(kybId, 'APPROVED', {
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    });

    // Update user role to verified issuer
    await this.userRepo.updateRole(kyb.issuerId, 'ISSUER');

    this.logger.log(`KYB approved: ${kybId} by admin ${adminUserId}`);

    await this.events.emit(Topics.KYB_APPROVED, {
      kybId,
      issuerId: kyb.issuerId,
      approvedAt: new Date().toISOString(),
    });

    return { kybId, status: 'APPROVED' };
  }

  async rejectKyb(kybId: string, adminUserId: string, reason: string) {
    const kyb = await this.kybRepo.findById(kybId);
    if (!kyb) throw new NotFoundException('KYB not found');

    await this.kybRepo.updateStatus(kybId, 'REJECTED', {
      rejectionReason: reason,
    });

    this.logger.log(`KYB rejected: ${kybId} by admin ${adminUserId}, reason: ${reason}`);
    return { kybId, status: 'REJECTED', reason };
  }

  async findPending() {
    return this.kybRepo.findPending();
  }
}
