import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { kafkaConfig } from '@chainstrike/config';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('settlement-service');

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Kafka consumer is optional — only attach when KAFKA_ENABLED=true.
  // Without Kafka (no broker running), settlement uses the HTTP /internal/settle path exclusively.
  if (process.env['KAFKA_ENABLED'] === 'true') {
    const kCfg = kafkaConfig('settlement');
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: { brokers: kCfg.brokers, clientId: kCfg.clientId },
        consumer: { groupId: kCfg.consumerGroup, allowAutoTopicCreation: true },
        run: { autoCommit: false },
      },
    });
    await app.startAllMicroservices();
    logger.info('Settlement Kafka consumer active');
  } else {
    logger.info('KAFKA_ENABLED=false — running HTTP-only settlement mode');
  }

  const port = process.env['SETTLEMENT_PORT'] ?? 3005;
  await app.listen(port);
  logger.info(`Settlement service listening on port ${port}`);
}

bootstrap();
