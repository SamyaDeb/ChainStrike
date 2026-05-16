import { Module } from '@nestjs/common';
import { KybController } from './kyb.controller';
import { KybService } from './kyb.service';
import { KybRepository } from './kyb.repository';
import { PrismaService } from '../prisma/prisma.service';
import { UserRepository } from '../user/user.repository';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  controllers: [KybController],
  providers: [KybService, KybRepository, PrismaService, UserRepository, EventProducerService],
  exports: [KybService],
})
export class KybModule {}
