import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { kafkaConfig } from '@chainstrike/config';
import { createServiceLogger } from '@chainstrike/logger';

(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('analytics-service');
  const kCfg = kafkaConfig('analytics');

  const app = await NestFactory.create(AppModule);
  if (process.env.KAFKA_ENABLED !== 'false') {
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
  }
  const port = process.env.ANALYTICS_PORT ?? 3007;
  await app.listen(port);
  logger.info(`Analytics service listening on port ${port}`);
}

bootstrap();
