import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementRepository } from './settlement.repository';
import { OrderMatchedConsumer } from './order-matched.consumer';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';
import { SignatureCollectorService } from '../signature/signature-collector.service';

@Module({
  providers: [
    SettlementService,
    SettlementRepository,
    OrderMatchedConsumer,
    PrismaService,
    EventProducerService,
    SignatureCollectorService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
