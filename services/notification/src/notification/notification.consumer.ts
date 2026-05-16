import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope } from '@chainstrike/types';
import { NotificationService } from './notification.service';

@Controller()
export class NotificationConsumer {
  constructor(private readonly notifications: NotificationService) {}

  @MessagePattern(Topics.KYC_VERIFIED)
  onKycVerified(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.KYC_VERIFIED, envelope);
  }

  @MessagePattern(Topics.KYB_APPROVED)
  onKybApproved(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.KYB_APPROVED, envelope);
  }

  @MessagePattern(Topics.ORDER_MATCHED)
  onOrderMatched(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.ORDER_MATCHED, envelope);
  }

  @MessagePattern(Topics.TRADE_SETTLED)
  onTradeSettled(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.TRADE_SETTLED, envelope);
  }

  @MessagePattern(Topics.SETTLEMENT_FAILED)
  onSettlementFailed(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.SETTLEMENT_FAILED, envelope);
  }

  @MessagePattern(Topics.COMPLIANCE_FLAGGED)
  onComplianceFlagged(@Payload() envelope: EventEnvelope<unknown>) {
    this.notifications.handle(Topics.COMPLIANCE_FLAGGED, envelope);
  }
}
