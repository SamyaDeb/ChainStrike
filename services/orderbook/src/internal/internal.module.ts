import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InternalGuard } from './internal.guard';
import { GatewayModule } from '../gateway/gateway.module';
import { MarketModule } from '../market/market.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrderRepository } from '../order/order.repository';
import { MatchingService } from '../matching/matching.service';
import { OrderBookStoreModule } from '../orderbook/order-book-store.module';

@Module({
  imports: [GatewayModule, MarketModule, OrderBookStoreModule, ConfigModule],
  controllers: [InternalController],
  providers: [PrismaService, OrderRepository, MatchingService, InternalGuard],
})
export class InternalModule {}
