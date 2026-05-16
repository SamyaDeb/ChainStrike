import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InternalGuard } from './internal.guard';
import { WhitelistModule } from '../whitelist/whitelist.module';

@Module({
  imports: [WhitelistModule, ConfigModule],
  controllers: [InternalController],
  providers: [InternalGuard],
})
export class InternalModule {}
