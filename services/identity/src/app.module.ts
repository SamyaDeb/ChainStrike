import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import { KafkaProducerModule } from './kafka/kafka-producer.module';
import { UserModule } from './user/user.module';
import { KycModule } from './kyc/kyc.module';
import { KybModule } from './kyb/kyb.module';
import { WalletModule } from './wallet/wallet.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
        IDENTITY_DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        SUMSUB_APP_TOKEN: Joi.string().required(),
        SUMSUB_SECRET_KEY: Joi.string().required(),
        KAFKA_BROKERS: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    KafkaProducerModule,
    AuthModule,
    UserModule,
    KycModule,
    KybModule,
    WalletModule,
  ],
})
export class AppModule {}
