import { Module } from '@nestjs/common';
import { WhitelistService } from './whitelist.service';
import { ComplianceController } from './whitelist.controller';
import { WhitelistRepository } from './whitelist.repository';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';
import { AlgorandService } from '../algorand/algorand.service';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [RulesModule],
  controllers: [ComplianceController],
  providers: [WhitelistService, WhitelistRepository, PrismaService, EventProducerService, AlgorandService],
  exports: [WhitelistService],
})
export class WhitelistModule {}
