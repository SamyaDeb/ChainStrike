import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import Joi from 'joi';
import { ProxyModule } from './proxy/proxy.module';
import { JwtStrategy } from './auth/jwt.strategy';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        IDENTITY_SERVICE_URL: Joi.string().required(),
        ASSET_SERVICE_URL: Joi.string().required(),
        COMPLIANCE_SERVICE_URL: Joi.string().required(),
        SETTLEMENT_SERVICE_URL: Joi.string().required(),
      }).options({ allowUnknown: true }),
    }),
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 120 },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    ProxyModule,
  ],
  controllers: [HealthController],
  providers: [JwtStrategy],
})
export class AppModule {}
