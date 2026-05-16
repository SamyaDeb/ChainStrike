import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, OrderPlacedPayload, OrderCancelledPayload, OrderMatchedPayload, TradeSettledPayload } from '@chainstrike/types';
import { OrderbookGateway } from '../gateway/orderbook.gateway';

@Controller()
export class MarketDataConsumer {
  private readonly logger = new Logger(MarketDataConsumer.name);

  constructor(private readonly gateway: OrderbookGateway) {}

  @MessagePattern(Topics.ORDER_PLACED)
  async handleOrderPlaced(@Payload() envelope: EventEnvelope<OrderPlacedPayload>) {
    const { payload } = envelope;
    this.logger.debug(`Broadcasting ORDER_PLACED: ${payload.orderId}`);

    this.gateway.broadcastOrderbookUpdate(payload.assetId, {
      type: 'ORDER_PLACED',
      orderId: payload.orderId,
      side: payload.side,
      price: payload.price,
      quantity: payload.quantity,
    });
  }

  @MessagePattern(Topics.ORDER_CANCELLED)
  async handleOrderCancelled(@Payload() envelope: EventEnvelope<OrderCancelledPayload>) {
    const { payload } = envelope;
    this.logger.debug(`Broadcasting ORDER_CANCELLED: ${payload.orderId}`);

    this.gateway.server.emit('orderbook:cancelled', {
      orderId: payload.orderId,
      reason: payload.reason,
    });
  }

  @MessagePattern(Topics.ORDER_MATCHED)
  async handleOrderMatched(@Payload() envelope: EventEnvelope<OrderMatchedPayload>) {
    const { payload } = envelope;
    this.logger.debug(`Broadcasting ORDER_MATCHED: ${payload.tradeId}`);

    this.gateway.broadcastTrade(payload.assetId, {
      tradeId: payload.tradeId,
      price: payload.price,
      quantity: payload.quantity,
      side: 'BUY',
      timestamp: new Date().toISOString(),
    });
  }

  @MessagePattern(Topics.TRADE_SETTLED)
  async handleTradeSettled(@Payload() envelope: EventEnvelope<TradeSettledPayload>) {
    const { payload } = envelope;
    this.logger.debug(`Broadcasting TRADE_SETTLED: ${payload.tradeId}`);

    this.gateway.broadcastTrade(payload.assetId, {
      tradeId: payload.tradeId,
      price: payload.price,
      quantity: payload.quantity,
      side: 'BUY',
      timestamp: payload.settledAt,
    });
  }
}
