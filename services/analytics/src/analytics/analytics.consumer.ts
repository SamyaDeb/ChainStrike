import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, OrderMatchedPayload, TradeSettledPayload } from '@chainstrike/types';
import { AnalyticsService } from './analytics.service';

@Controller()
export class AnalyticsConsumer {
  constructor(private readonly analytics: AnalyticsService) {}

  @MessagePattern(Topics.ORDER_MATCHED)
  onOrderMatched(@Payload() envelope: EventEnvelope<OrderMatchedPayload>) {
    this.analytics.onOrderMatched(envelope);
  }

  @MessagePattern(Topics.TRADE_SETTLED)
  onTradeSettled(@Payload() envelope: EventEnvelope<TradeSettledPayload>) {
    this.analytics.onTradeSettled(envelope);
  }
}
