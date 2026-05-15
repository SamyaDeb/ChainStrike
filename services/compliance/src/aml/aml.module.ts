import { Module } from '@nestjs/common';
import { AmlService } from './aml.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  providers: [AmlService, PrismaService, EventProducerService],
  exports: [AmlService],
})
export class AmlModule {}
