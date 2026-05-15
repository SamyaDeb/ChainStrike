import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { kafkaConfig } from '@chainstrike/config';
import { ConsumerGroups } from '@chainstrike/events';
import { AppModule } from './app.module';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('compliance-service');
  const kCfg = kafkaConfig('compliance');

  // Hybrid: HTTP for pre-trade endpoint + Kafka consumer for KYC events
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { brokers: kCfg.brokers, clientId: kCfg.clientId },
      consumer: { groupId: ConsumerGroups.COMPLIANCE_KYC, allowAutoTopicCreation: true },
    },
  });

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('ChainStrike Compliance API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  await app.startAllMicroservices();
  const port = process.env.COMPLIANCE_SERVICE_PORT ?? 3004;
  await app.listen(port);
  logger.info(`Compliance service listening on port ${port}`);
}

bootstrap().catch((err) => { console.error(err); process.exit(1); });
