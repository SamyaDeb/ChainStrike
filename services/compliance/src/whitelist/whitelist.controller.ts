import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { WhitelistService } from './whitelist.service';
import { RulesService } from '../rules/rules.service';

class PreTradeCheckDto {
  @IsString() walletAddress: string;
  @IsNumber() @Type(() => Number) assetId: number;
  @IsString() side: string;
  @IsString() quantity: string;
  @IsString() @IsOptional() price?: string;
  @IsNumber() @Type(() => Number) kycTier: number;
}

class DevWhitelistDto {
  @IsString() walletAddress: string;
  @IsNumber() @Type(() => Number) asaId: number;
  @IsString() assetId: string;
  @IsString() userId: string;
}

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly whitelistService: WhitelistService,
    private readonly rulesService: RulesService,
  ) {}

  // Called internally by Orderbook Service — no JWT required (internal network only)
  @Post('pre-trade')
  @ApiOperation({ summary: 'Run pre-trade compliance check (internal)' })
  async preTradeCheck(@Body() dto: PreTradeCheckDto) {
    return this.rulesService.checkPreTrade({
      buyerWallet: dto.walletAddress,
      assetId: dto.assetId,
      quantity: BigInt(dto.quantity),
      price: dto.price ? BigInt(dto.price) : 0n,
      buyerKycTier: dto.kycTier,
      buyerAnnualVolume: 0n,
    });
  }

  @Get('whitelist/:walletAddress')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get whitelist entries for a wallet' })
  async getWhitelist(@Param('walletAddress') walletAddress: string) {
    return this.whitelistService.getWhitelistForWallet(walletAddress);
  }

  // ─── Dev-only: self-approve wallet for testnet testing ───────────────────────
  // Gated by NODE_ENV — never enabled in production.
  @Post('dev/whitelist')
  @ApiOperation({ summary: '[DEV ONLY] Self-approve a wallet for testnet testing' })
  async devWhitelist(@Body() dto: DevWhitelistDto) {
    if (process.env['NODE_ENV'] === 'production') {
      return { error: 'Not available in production' };
    }
    return this.whitelistService.devApproveWallet(
      dto.walletAddress,
      dto.asaId,
      dto.assetId,
      dto.userId,
    );
  }
}
