import { Module } from '@nestjs/common';
import { AnalyticsConsumer } from './analytics.consumer';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsConsumer, AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
