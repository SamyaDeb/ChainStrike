import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import { Topics } from '@chainstrike/events';
import { EventEnvelope, OrderMatchedPayload } from '@chainstrike/types';
import { SettlementService } from './settlement.service';

@Controller()
export class OrderMatchedConsumer {
  private readonly logger = new Logger(OrderMatchedConsumer.name);

  constructor(private readonly settlementService: SettlementService) {}

  @MessagePattern(Topics.ORDER_MATCHED)
  async handleOrderMatched(
    @Payload() envelope: EventEnvelope<OrderMatchedPayload>,
    @Ctx() context: KafkaContext,
  ) {
    const { payload } = envelope;
    this.logger.log(`Processing ORDER_MATCHED: tradeId=${payload.tradeId}`);

    await this.settlementService.processMatch(payload);

    const { offset } = context.getMessage();
    await context.getConsumer().commitOffsets([
      { topic: context.getTopic(), partition: context.getPartition(), offset: String(Number(offset) + 1) },
    ]);
  }
}
