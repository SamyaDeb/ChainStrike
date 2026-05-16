import {
  Controller, Post, Get, Patch, Body, Param, Req, UseGuards, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';

class VerificationStageDto {
  @IsInt() @Min(1) @Max(5)
  stage: number;

  @IsEnum(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsString() @IsOptional()
  notes?: string;
}

class DistributeTokensDto {
  @IsString()
  issuerWalletAddress: string;

  @IsString()
  amount: string;
}

class SeedOrdersDto {
  @IsString()
  issuerWalletAddress: string;

  @IsString()
  seedQuantity: string;
}

@ApiTags('assets')
@Controller('assets')
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly config: ConfigService,
  ) {}

  @Get('algorand-params')
  @ApiOperation({ summary: 'Get Algorand network config for on-chain transactions (public)' })
  getAlgorandParams() {
    const network = this.config.get('ALGORAND_NETWORK', 'testnet');
    return {
      network,
      usdcAsaId: network === 'mainnet' ? 31566704 : 10458941,
      platformAddress: this.config.get('ALGORAND_PLATFORM_ADDRESS', ''),
      algodServer: this.config.get('ALGORAND_ALGOD_SERVER', 'https://testnet-api.algonode.cloud'),
      algodToken: '',
      algodPort: 443,
    };
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Submit a new RWA asset application (issuer only)' })
  async create(@Req() req: { user: { id: string } }, @Body() dto: CreateAssetDto) {
    return this.assetService.createAsset(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active assets (marketplace)' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(@Query('category') category?: string, @Query('status') status?: string) {
    return this.assetService.findAll({ category, status: status ?? 'ACTIVE' });
  }

  @Get('my')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get all assets for current issuer' })
  async findMyAssets(@Req() req: { user: { id: string } }) {
    return this.assetService.findByIssuer(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get asset detail' })
  async findOne(@Param('id') id: string) {
    return this.assetService.findById(id);
  }

  @Patch(':id/approve')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Approve asset verification (admin only)' })
  async approve(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.approveVerification(id, req.user.id);
  }

  @Patch(':id/deploy-asa')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Deploy ASA to Algorand (admin only, after verification)' })
  async deployAsa(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.deployAsaToMainnet(id, req.user.id);
  }

  @Patch(':id/activate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Activate market for trading (admin only)' })
  async activate(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.activateMarket(id, req.user.id);
  }

  @Post(':id/seed-orders')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Seed initial SELL orders in orderbook from issuer wallet (admin only)' })
  async seedOrders(
    @Param('id') id: string,
    @Body() body: SeedOrdersDto,
  ) {
    return this.assetService.seedOrders(id, body.issuerWalletAddress, BigInt(body.seedQuantity));
  }

  @Post(':id/verification-stage')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Submit per-stage verification decision (admin only)' })
  async addVerificationStage(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @Body() body: VerificationStageDto,
  ) {
    return this.assetService.addVerificationStage(id, req.user.id, body);
  }

  // Testnet only: sends 100 USDC from admin wallet to the specified wallet.
  @Post('dispense-usdc')
  @ApiOperation({ summary: '[TESTNET] Send 100 test USDC to a wallet address' })
  async dispenseUsdc(@Body() body: { walletAddress: string }) {
    if (!body.walletAddress) {
      throw new Error('walletAddress required');
    }
    return this.assetService.dispenseTestnetUsdc(body.walletAddress);
  }

  // Called by the investor frontend before placing the first BUY order.
  // Opts the platform escrow address into USDC so it can receive payment.
  @Post('setup-escrow')
  @ApiOperation({ summary: 'Opt platform escrow into USDC (idempotent, no auth required in dev)' })
  async setupEscrow() {
    const network = this.config.get('ALGORAND_NETWORK', 'testnet');
    return this.assetService.setupEscrowUsdcOptIn(network);
  }

  @Post(':id/distribute-tokens')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Transfer tokens from admin wallet to issuer wallet (admin only)' })
  async distributeTokens(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @Body() body: DistributeTokensDto,
  ) {
    return this.assetService.distributeTokens(id, body.issuerWalletAddress, BigInt(body.amount));
  }
}
