import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletService } from './wallet.service';

class ConnectWalletDto {
  @ApiProperty({ example: 'AAAA...', description: 'Algorand wallet address' })
  @IsString() @IsNotEmpty() address: string;

  @ApiProperty() @IsString() @IsNotEmpty() signedChallenge: string;
  @ApiProperty() @IsString() @IsNotEmpty() challenge: string;
  @ApiProperty({ example: 'mainnet' }) @IsString() network: string;
}

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('challenge')
  @ApiOperation({ summary: 'Get a challenge string to sign with your Algorand wallet' })
  getChallenge(@Req() req: { user: { id: string } }) {
    return { challenge: this.walletService.generateChallenge(req.user.id) };
  }

  @Post('connect')
  @ApiOperation({ summary: 'Connect an Algorand wallet by proving ownership via signature' })
  async connect(@Req() req: { user: { id: string } }, @Body() dto: ConnectWalletDto) {
    return this.walletService.connectWallet(
      req.user.id,
      dto.address,
      dto.signedChallenge,
      dto.challenge,
      dto.network,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all connected wallets for the current user' })
  async list(@Req() req: { user: { id: string } }) {
    return this.walletService.getWallets(req.user.id);
  }
}
