import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PassportModule } from '@nestjs/passport';
import Joi from 'joi';
import { WhitelistModule } from './whitelist/whitelist.module';
import { InternalModule } from './internal/internal.module';
import { AmlModule } from './aml/aml.module';
import { RulesModule } from './rules/rules.module';
import { ReportingModule } from './reporting/reporting.module';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().required(),
        ALGORAND_ALGOD_SERVER: Joi.string().required(),
        ALGORAND_ALGOD_TOKEN: Joi.string().allow('').required(),
        JWT_SECRET: Joi.string().required(),
        WHITELIST_REGISTRY_APP_ID: Joi.string().default('762425821'),
      }).options({ allowUnknown: true }),
    }),
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    WhitelistModule,
    InternalModule,
    AmlModule,
    RulesModule,
    ReportingModule,
  ],
  providers: [JwtStrategy],
})
export class AppModule {}
