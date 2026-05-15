import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRepository } from './order.repository';
import { MarketRepository } from '../market/market.repository';
import { ComplianceCheckService } from '../compliance/compliance-check.service';
import { AssetEventConsumer } from '../events/asset-event.consumer';
import { MarketDataConsumer } from '../events/market-data.consumer';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';
import { MarketService } from '../market/market.service';
import { GatewayModule } from '../gateway/gateway.module';
import { EscrowService } from '../escrow/escrow.service';

@Module({
  imports: [GatewayModule],
  controllers: [OrderController, AssetEventConsumer, MarketDataConsumer],
  providers: [
    OrderService,
    OrderRepository,
    MarketRepository,
    MarketService,
    ComplianceCheckService,
    PrismaService,
    EventProducerService,
    EscrowService,
  ],
  exports: [OrderService],
})
export class OrderModule {}
