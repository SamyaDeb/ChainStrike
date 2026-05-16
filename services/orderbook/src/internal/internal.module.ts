import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { MarketModule } from '../market/market.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrderRepository } from '../order/order.repository';

@Module({
  imports: [GatewayModule, MarketModule],
  controllers: [InternalController],
  providers: [PrismaService, OrderRepository],
})
export class InternalModule {}
