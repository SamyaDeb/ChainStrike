import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = createServiceLogger('orderbook-service');

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

  const port = process.env.ORDERBOOK_PORT ?? 3003;
  await app.listen(port);
  logger.info(`Orderbook service listening on port ${port} (HTTP + WebSocket)`);
}

bootstrap();
