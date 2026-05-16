import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createServiceLogger } from '@chainstrike/logger';

// BigInt JSON serialization
(BigInt.prototype as any).toJSON = function() { return this.toString(); };

async function bootstrap() {
  const logger = createServiceLogger('compliance-service');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('ChainStrike Compliance API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.COMPLIANCE_SERVICE_PORT ?? 3004;
  await app.listen(port);
  logger.info(`Compliance service listening on port ${port}`);
}

bootstrap().catch((err) => { console.error(err); process.exit(1); });
