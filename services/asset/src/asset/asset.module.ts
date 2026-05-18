import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { AssetRepository } from './asset.repository';
import { PrismaService } from '../prisma/prisma.service';
import { EventProducerService } from '../events/event-producer.service';
import { AlgorandAssetService } from '../algorand/algorand-asset.service';
import { DocumentModule } from '../document/document.module';
import { PricefeedService } from '../pricefeed/pricefeed.service';

@Module({
  imports: [DocumentModule, ConfigModule],
  controllers: [AssetController],
  providers: [AssetService, AssetRepository, PrismaService, EventProducerService, AlgorandAssetService, PricefeedService],
  exports: [AssetService],
})
export class AssetModule {}
