import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('ohlcv/:asaId')
  getOhlcv(@Param('asaId', ParseIntPipe) asaId: number) {
    return this.analytics.getOhlcv(asaId);
  }

  @Get('summary/:asaId')
  getSummary(@Param('asaId', ParseIntPipe) asaId: number) {
    return this.analytics.getSummary(asaId);
  }
}
