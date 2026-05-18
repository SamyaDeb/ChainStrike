import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Logos are sent as base64 data URLs in the JSON body (~270 KB for a 200 KB
  // image), which exceeds Express's default 100 KB limit and caused HTTP 413.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'] });

  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ChainStrike Asset Service')
      .setDescription('RWA tokenization, asset lifecycle, document management')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(process.env['ASSET_SERVICE_PORT'] ?? 3002);
  console.log('Asset Service running');
}

bootstrap().catch((err) => { console.error(err); process.exit(1); });
