import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycRepository } from './kyc.repository';
import { SumsubModule } from '../sumsub/sumsub.module';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  imports: [SumsubModule],
  controllers: [KycController],
  providers: [KycService, KycRepository, PrismaService, EventProducerService],
  exports: [KycService],
})
export class KycModule {}
