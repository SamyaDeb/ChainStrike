import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { SettlementModule } from '../settlement/settlement.module';

@Module({
  imports: [SettlementModule],
  controllers: [InternalController],
})
export class InternalModule {}
