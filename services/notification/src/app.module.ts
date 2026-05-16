import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import Joi from 'joi';
import { kafkaConfig } from '@chainstrike/config';
import { NotificationModule } from './notification/notification.module';

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
    ClientsModule.register([
      {
        name: 'KAFKA_PRODUCER',
        transport: Transport.KAFKA,
        options: {
          client: {
            brokers: kafkaConfig('notification').brokers,
            clientId: kafkaConfig('notification').clientId,
          },
        },
      },
    ]),
    NotificationModule,
  ],
})
export class AppModule {}
