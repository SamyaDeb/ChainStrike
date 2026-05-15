import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { SignatureCollectorService } from '../signature/signature-collector.service';

@Module({
  providers: [SignatureCollectorService],
  controllers: [InternalController],
  exports: [SignatureCollectorService],
})
export class InternalModule {}
