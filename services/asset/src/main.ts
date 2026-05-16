import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
