import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRepository } from './order.repository';
import { MarketRepository } from '../market/market.repository';
import { ComplianceCheckService } from '../compliance/compliance-check.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { GatewayModule } from '../gateway/gateway.module';
import { EscrowService } from '../escrow/escrow.service';
import { DevMatchingService } from './dev-matching.service';
import { MatchingService } from '../matching/matching.service';

@Module({
  imports: [GatewayModule, ConfigModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderRepository,
    MarketRepository,
    MarketService,
    ComplianceCheckService,
    PrismaService,
    EscrowService,
    DevMatchingService,
    MatchingService,
  ],
  exports: [OrderService],
})
export class OrderModule {}
