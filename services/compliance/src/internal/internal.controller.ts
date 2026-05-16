import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { WhitelistService } from '../whitelist/whitelist.service';

interface WhitelistAddPayload {
  userId: string;
  walletAddress: string;
  assetId: string;
  asaId: number;
  tier: number;
  expiresAt?: string;
}

interface WhitelistRemovePayload {
  userId: string;
  walletAddress: string;
  reason?: string;
}

@UseGuards(InternalGuard)
@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly whitelistService: WhitelistService) {}

  @Post('whitelist/add')
  async addToWhitelist(@Body() payload: WhitelistAddPayload) {
    this.logger.log(`Internal whitelist add: ${payload.walletAddress} for asset ${payload.asaId}`);
    try {
      await this.whitelistService.addToWhitelist(
        payload.walletAddress,
        payload.assetId,
        payload.asaId,
        payload.userId,
        payload.tier,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      );
      return { success: true };
    } catch (err) {
      this.logger.error(`Whitelist add failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  @Post('whitelist/remove')
  async removeFromWhitelist(@Body() payload: WhitelistRemovePayload) {
    this.logger.log(`Internal whitelist remove: ${payload.walletAddress}`);
    try {
      await this.whitelistService.removeAllForWallet(
        payload.walletAddress,
        payload.reason ?? 'KYC expired',
      );
      return { success: true };
    } catch (err) {
      this.logger.error(`Whitelist remove failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
