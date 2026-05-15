import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PassportModule } from '@nestjs/passport';
import Joi from 'joi';
import { KafkaProducerModule } from './kafka/kafka-producer.module';
import { AssetModule } from './asset/asset.module';
import { DocumentModule } from './document/document.module';
import { VerificationModule } from './verification/verification.module';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        ASSET_DATABASE_URL: Joi.string().required(),
        KAFKA_BROKERS: Joi.string().required(),
        AWS_S3_BUCKET_DOCUMENTS: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    KafkaProducerModule,
    AssetModule,
    DocumentModule,
    VerificationModule,
  ],
  providers: [JwtStrategy],
})
export class AppModule {}
