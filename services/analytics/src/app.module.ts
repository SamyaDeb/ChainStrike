import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        KAFKA_BROKERS: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    AnalyticsModule,
  ],
})
export class AppModule {}
