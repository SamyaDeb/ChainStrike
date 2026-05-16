import {
  Controller, Post, Get, Delete, Body, Param, Req, UseGuards, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { MarketRepository } from '../market/market.repository';
import { PlaceOrderDto } from './dto/place-order.dto';
import { DevMatchingService } from './dev-matching.service';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly marketRepo: MarketRepository,
    private readonly devMatching: DevMatchingService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Place a new order' })
  async placeOrder(
    @Req() req: { user: { id: string; kycTier: number } },
    @Body() dto: PlaceOrderDto,
  ) {
    return this.orderService.placeOrder(req.user.id, req.user.kycTier, dto);
  }

  @Get('my')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get my open orders' })
  async myOrders(@Req() req: { user: { id: string } }) {
    return this.orderService.getActiveOrdersForUser(req.user.id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Cancel an order' })
  async cancel(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.orderService.cancelOrder(id, req.user.id);
  }

  // ─── Public market data endpoints (no auth required) ─────────────────────────

  @Get(':assetId/depth')
  @ApiOperation({ summary: 'Get order book depth snapshot (public)' })
  @ApiQuery({ name: 'levels', required: false })
  async depth(
    @Param('assetId') assetId: string,
    @Query('levels') levels?: string,
  ) {
    return this.marketRepo.getDepthSnapshot(assetId, Number(levels ?? 20));
  }

  @Post(':assetId/dev/trigger-match')
  @ApiOperation({ summary: '[DEV] Synchronously run price-time matching for an asset (bypasses Kafka)' })
  async devTriggerMatch(@Param('assetId') assetId: string) {
    return this.devMatching.triggerMatch(assetId);
  }

  @Get(':assetId/ohlcv')
  @ApiOperation({ summary: 'Get OHLCV candles for price chart (public)' })
  @ApiQuery({ name: 'interval', required: false, description: '1m | 5m | 15m | 1h | 4h | 1d' })
  @ApiQuery({ name: 'limit', required: false })
  async ohlcv(
    @Param('assetId') assetId: string,
    @Query('interval') interval = '1h',
    @Query('limit') limit = '60',
  ) {
    return this.marketRepo.getOhlcv(assetId, interval, Number(limit));
  }
}
