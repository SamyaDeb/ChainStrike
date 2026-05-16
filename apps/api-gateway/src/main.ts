import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createServiceLogger } from '@chainstrike/logger';

async function bootstrap() {
  // Disable body parser: gateway is a pure proxy — parsing the body here
  // consumes the stream and prevents http-proxy-middleware from forwarding it.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const logger = createServiceLogger('api-gateway');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }));

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [
      'http://localhost:3000',
      'http://localhost:3100',
      'http://localhost:3101',
    ],
    credentials: true,
  });

  // No global ValidationPipe — validation is done in each downstream service.

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ChainStrike API')
    .setDescription('ChainStrike RWA Exchange — unified API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = process.env.GATEWAY_PORT ?? 8080;
  await app.listen(port);
  logger.info(`API Gateway listening on port ${port}`);
}

bootstrap();
