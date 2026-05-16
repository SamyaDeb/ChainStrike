import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, OrderPlacedPayload } from '@chainstrike/types';
import { MatchingEngine } from './matching.engine';

@Controller()
export class OrderPlacedConsumer {
  private readonly logger = new Logger(OrderPlacedConsumer.name);

  constructor(private readonly engine: MatchingEngine) {}

  @MessagePattern(Topics.ORDER_PLACED)
  async handleOrderPlaced(
    @Payload() envelope: EventEnvelope<OrderPlacedPayload>,
    @Ctx() context: KafkaContext,
  ) {
    const { payload } = envelope;
    this.logger.debug(`Processing ORDER_PLACED: ${payload.orderId}`);

    await this.engine.processOrder({
      orderId: payload.orderId,
      userId: payload.userId,
      assetId: payload.assetId,
      asaId: payload.asaId,
      side: payload.side.toLowerCase() as 'buy' | 'sell',
      type: payload.orderType.toLowerCase() as 'limit' | 'market',
      timeInForce: (payload.timeInForce ?? 'GTC') as 'GTC' | 'IOC' | 'FOK',
      price: payload.price ? BigInt(payload.price) : undefined,
      quantity: BigInt(payload.quantity),
      remainingQuantity: BigInt(payload.quantity),
      walletAddress: payload.walletAddress,
      timestamp: Date.now(),
    });

    // Commit offset after successful processing
    const { offset } = context.getMessage();
    const partition = context.getPartition();
    const topic = context.getTopic();
    await context.getConsumer().commitOffsets([
      { topic, partition, offset: String(Number(offset) + 1) },
    ]);
  }

  @MessagePattern(Topics.ORDER_CANCELLED)
  async handleOrderCancelled(
    @Payload() envelope: EventEnvelope<{ orderId: string; assetId: string }>,
  ) {
    const { orderId, assetId } = envelope.payload;
    await this.engine.removeOrder(assetId, orderId);
  }
}
