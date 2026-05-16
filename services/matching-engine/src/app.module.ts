import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { KafkaProducerModule } from './kafka/kafka-producer.module';
import { EngineModule } from './engine/engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        KAFKA_BROKERS: Joi.string().required(),
        REDIS_HOST: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    KafkaProducerModule,
    EngineModule,
  ],
})
export class AppModule {}
