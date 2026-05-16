import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PassportModule } from '@nestjs/passport';
import Joi from 'joi';
import { OrderModule } from './order/order.module';
import { MarketModule } from './market/market.module';
import { GatewayModule } from './gateway/gateway.module';
import { InternalModule } from './internal/internal.module';
import { OrderBookStoreModule } from './orderbook/order-book-store.module';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        ALGORAND_ADMIN_MNEMONIC: Joi.string().required(),
        ESCROW_CONTRACT_APP_ID: Joi.string().required(),
        SETTLEMENT_SERVICE_URL: Joi.string().default('http://localhost:3005'),
        TREASURY_WALLET_ADDRESS: Joi.string().required(),
        COMPLIANCE_SERVICE_URL: Joi.string().default('http://localhost:3004'),
      }).options({ allowUnknown: true }),
    }),
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    OrderBookStoreModule,
    OrderModule,
    MarketModule,
    GatewayModule,
    InternalModule,
  ],
  providers: [JwtStrategy],
})
export class AppModule {}
