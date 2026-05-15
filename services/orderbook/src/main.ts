import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { kafkaConfig } from '@chainstrike/config';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = createServiceLogger('orderbook-service');
  const kCfg = kafkaConfig('orderbook');

  // Hybrid: HTTP for REST API + Kafka consumer for ASSET events
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { brokers: kCfg.brokers, clientId: `${kCfg.clientId}-consumer` },
      consumer: { groupId: kCfg.consumerGroup, allowAutoTopicCreation: true },
    },
  });

  app.use(helmet());
  app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const config = new DocumentBuilder()
    .setTitle('ChainStrike Orderbook API')
    .setDescription('CLOB orderbook service')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  await app.startAllMicroservices();
  const port = process.env.ORDERBOOK_PORT ?? 3003;
  await app.listen(port);
  logger.info(`Orderbook service listening on port ${port} (HTTP + WebSocket + Kafka)`);
}

bootstrap();
