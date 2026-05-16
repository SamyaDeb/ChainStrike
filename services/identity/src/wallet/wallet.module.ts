import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletRepository } from './wallet.repository';
import { KycRepository } from '../kyc/kyc.repository';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, WalletRepository, KycRepository, PrismaService, EventProducerService],
  exports: [WalletService],
})
export class WalletModule {}
