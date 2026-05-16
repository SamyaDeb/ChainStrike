import { Module } from '@nestjs/common';
import { WhitelistService } from './whitelist.service';
import { ComplianceController } from './whitelist.controller';
import { WhitelistRepository } from './whitelist.repository';
import { PrismaService } from '../prisma/prisma.service';
import { AlgorandService } from '../algorand/algorand.service';
import { RulesModule } from '../rules/rules.module';
import { ReportingModule } from '../reporting/reporting.module';

@Module({
  imports: [RulesModule, ReportingModule],
  controllers: [ComplianceController],
  providers: [WhitelistService, WhitelistRepository, PrismaService, AlgorandService],
  exports: [WhitelistService],
})
export class WhitelistModule {}
