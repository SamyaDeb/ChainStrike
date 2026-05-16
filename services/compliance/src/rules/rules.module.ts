import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RulesService } from './rules.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  providers: [RulesService, PrismaService],
  exports: [RulesService],
})
export class RulesModule {}
