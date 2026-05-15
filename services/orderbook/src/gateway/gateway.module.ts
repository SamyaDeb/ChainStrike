import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrderbookGateway } from './orderbook.gateway';
import { MarketRepository } from '../market/market.repository';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [OrderbookGateway, MarketRepository, PrismaService],
  exports: [OrderbookGateway],
})
export class GatewayModule {}
