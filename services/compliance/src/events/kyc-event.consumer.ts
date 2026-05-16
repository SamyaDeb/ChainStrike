import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, KycVerifiedPayload, KycExpiredPayload, AccountFrozenPayload } from '@chainstrike/types';
import { WhitelistService } from '../whitelist/whitelist.service';

@Controller()
export class KycEventConsumer {
  private readonly logger = new Logger(KycEventConsumer.name);

  constructor(private readonly whitelistService: WhitelistService) {}

  @MessagePattern(Topics.KYC_VERIFIED)
  async handleKycVerified(@Payload() envelope: EventEnvelope<KycVerifiedPayload>) {
    this.logger.log(`KYC verified for user ${envelope.payload.userId}, tier=${envelope.payload.tier}`);
    await this.whitelistService.handleKycVerified(envelope.payload);
  }

  @MessagePattern(Topics.KYC_EXPIRED)
  async handleKycExpired(@Payload() envelope: EventEnvelope<KycExpiredPayload>) {
    this.logger.warn(`KYC expired for user ${envelope.payload.userId}`);
    // Remove from all whitelists — compliance service handles expiry
    const walletAddresses = envelope.payload.walletAddress ? [envelope.payload.walletAddress] : [];
    await this.whitelistService.handleKycExpired(envelope.payload.userId, walletAddresses);
  }

  @MessagePattern(Topics.ACCOUNT_FROZEN)
  async handleAccountFrozen(@Payload() envelope: EventEnvelope<AccountFrozenPayload>) {
    this.logger.warn(`Account frozen: ${envelope.payload.walletAddress}, reason=${envelope.payload.reason}`);
    await this.whitelistService.removeAllForWallet(envelope.payload.walletAddress, envelope.payload.reason);
  }
}
