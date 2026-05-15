import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [RulesService, PrismaService],
  exports: [RulesService],
})
export class RulesModule {}
