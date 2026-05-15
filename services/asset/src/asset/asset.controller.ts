import {
  Controller, Post, Get, Patch, Body, Param, Req, UseGuards, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
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
  @ApiOperation({ summary: 'Approve asset verification (admin only)' })
  async approve(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.approveVerification(id, req.user.id);
  }

  @Patch(':id/deploy-asa')
  @ApiOperation({ summary: 'Deploy ASA to Algorand (admin only, after verification)' })
  async deployAsa(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.deployAsaToMainnet(id, req.user.id);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate market for trading (admin only)' })
  async activate(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.assetService.activateMarket(id, req.user.id);
  }
}
