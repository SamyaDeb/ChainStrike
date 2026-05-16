import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [ReportingService, PrismaService],
  exports: [ReportingService],
})
export class ReportingModule {}
