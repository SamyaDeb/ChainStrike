import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementRepository } from './settlement.repository';
import { OrderMatchedConsumer } from './order-matched.consumer';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  providers: [
    SettlementService,
    SettlementRepository,
    PrismaService,
    EventProducerService,
    OrderMatchedConsumer,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
