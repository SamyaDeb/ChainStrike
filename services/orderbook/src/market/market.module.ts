import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketRepository } from './market.repository';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [MarketService, MarketRepository, PrismaService],
  exports: [MarketService, MarketRepository],
})
export class MarketModule {}
