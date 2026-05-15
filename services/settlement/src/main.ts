import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { kafkaConfig } from '@chainstrike/config';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('settlement-service');
  const kCfg = kafkaConfig('settlement');

  // Settlement runs as a hybrid app: Kafka consumer + HTTP for WebSocket signing
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: kCfg.brokers,
        clientId: kCfg.clientId,
      },
      consumer: {
        groupId: kCfg.consumerGroup,
        allowAutoTopicCreation: true,
      },
    },
  });

  await app.startAllMicroservices();
  const port = process.env.SETTLEMENT_PORT ?? 3004;
  await app.listen(port);
  logger.info(`Settlement service listening on port ${port}`);
}

bootstrap();
