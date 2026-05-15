import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [VerificationService, PrismaService],
  exports: [VerificationService],
})
export class VerificationModule {}
