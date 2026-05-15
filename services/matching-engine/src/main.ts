import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { kafkaConfig } from '@chainstrike/config';
import { createServiceLogger } from '@chainstrike/logger';

(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('matching-engine');
  const kCfg = kafkaConfig('matching-engine');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: kCfg.brokers,
        clientId: kCfg.clientId,
      },
      consumer: {
        groupId: kCfg.consumerGroup,
        // Process order events with at-least-once semantics + manual offset commit
        allowAutoTopicCreation: true,
      },
      run: {
        autoCommit: false,
      },
    },
  });

  await app.listen();
  logger.info('Matching engine microservice started');
}

bootstrap();
