import { Module } from '@nestjs/common';
import { MatchingEngine } from './matching.engine';
import { OrderBookStore } from '../book/order-book.store';
import { OrderPlacedConsumer } from './order-placed.consumer';
import { EventProducerService } from '../events/event-producer.service';

@Module({
  providers: [MatchingEngine, OrderBookStore, OrderPlacedConsumer, EventProducerService],
})
export class EngineModule {}
