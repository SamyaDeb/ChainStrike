import { Module } from '@nestjs/common';
import { AmlService } from './aml.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [AmlService, PrismaService],
  exports: [AmlService],
})
export class AmlModule {}
