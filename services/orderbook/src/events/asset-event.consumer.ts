import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, AssetCreatedPayload, AssetStatusChangedPayload } from '@chainstrike/types';
import { MarketService } from '../market/market.service';

@Controller()
export class AssetEventConsumer {
  private readonly logger = new Logger(AssetEventConsumer.name);

  constructor(private readonly marketService: MarketService) {}

  // When an ASA is deployed, open the market for pre-market trading setup
  @MessagePattern(Topics.ASSET_CREATED)
  async handleAssetCreated(@Payload() envelope: EventEnvelope<AssetCreatedPayload>) {
    const { assetId, asaId, ticker } = envelope.payload;
    this.logger.log(`Opening market for asset ${assetId} (ASA ${asaId})`);
    await this.marketService.openMarket(assetId, asaId, ticker);
  }

  // When admin activates the asset, flip market to ACTIVE
  @MessagePattern(Topics.ASSET_STATUS_CHANGED)
  async handleAssetStatusChanged(@Payload() envelope: EventEnvelope<AssetStatusChangedPayload>) {
    const { assetId, newStatus } = envelope.payload;
    if (newStatus === 'ACTIVE') {
      this.logger.log(`Activating market for asset ${assetId}`);
      await this.marketService.activateMarket(assetId);
    }
  }
}
