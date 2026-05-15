import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PassportModule } from '@nestjs/passport';
import Joi from 'joi';
import { KafkaProducerModule } from './kafka/kafka-producer.module';
import { WhitelistModule } from './whitelist/whitelist.module';
import { AmlModule } from './aml/aml.module';
import { RulesModule } from './rules/rules.module';
import { ReportingModule } from './reporting/reporting.module';
import { KycEventConsumerModule } from './events/kyc-event.module';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        COMPLIANCE_DATABASE_URL: Joi.string().required(),
        ALGORAND_ALGOD_SERVER: Joi.string().required(),
        ALGORAND_ALGOD_TOKEN: Joi.string().allow('').required(),
        KAFKA_BROKERS: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    KafkaProducerModule,
    WhitelistModule,
    AmlModule,
    RulesModule,
    ReportingModule,
    KycEventConsumerModule,
  ],
  providers: [JwtStrategy],
})
export class AppModule {}
