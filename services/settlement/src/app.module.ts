import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import Joi from 'joi';
import { SettlementModule } from './settlement/settlement.module';
import { InternalModule } from './internal/internal.module';
import { KafkaProducerModule } from './kafka/kafka-producer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        ALGORAND_ALGOD_SERVER: Joi.string().required(),
        ALGORAND_ALGOD_TOKEN: Joi.string().allow('').required(),
        ALGORAND_ADMIN_MNEMONIC: Joi.string().required(),
        ESCROW_CONTRACT_APP_ID: Joi.string().required(),
        TREASURY_WALLET_ADDRESS: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    ScheduleModule.forRoot(),
    KafkaProducerModule,
    SettlementModule,
    InternalModule,
  ],
})
export class AppModule {}
