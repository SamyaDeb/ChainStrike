import { Module } from '@nestjs/common';
import { KycEventConsumer } from './kyc-event.consumer';
import { WhitelistModule } from '../whitelist/whitelist.module';

@Module({
  imports: [WhitelistModule],
  controllers: [KycEventConsumer],
})
export class KycEventConsumerModule {}
