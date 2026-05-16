import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { WhitelistModule } from '../whitelist/whitelist.module';

@Module({
  imports: [WhitelistModule],
  controllers: [InternalController],
})
export class InternalModule {}
