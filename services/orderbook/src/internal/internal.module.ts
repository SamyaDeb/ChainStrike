import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [InternalController],
})
export class InternalModule {}
