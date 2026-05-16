import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InternalGuard } from './internal.guard';
import { SettlementModule } from '../settlement/settlement.module';

@Module({
  imports: [SettlementModule, ConfigModule],
  controllers: [InternalController],
  providers: [InternalGuard],
})
export class InternalModule {}
