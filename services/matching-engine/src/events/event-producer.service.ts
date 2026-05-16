import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { EventEnvelope } from '@chainstrike/types';
import { randomUUID } from 'crypto';

@Injectable()
export class EventProducerService implements OnModuleInit {
  private readonly logger = new Logger(EventProducerService.name);

  constructor(@Inject('KAFKA_PRODUCER') private readonly kafka: ClientKafka) {}

  async onModuleInit() { await this.kafka.connect(); }

  async emit<T>(topic: string, payload: T): Promise<void> {
    const envelope: EventEnvelope<T> = {
      eventId: randomUUID(),
      eventType: topic,
      source: 'matching-engine',
      version: '1.0',
      timestamp: new Date().toISOString(),
      payload,
    };
    this.kafka.emit(topic, envelope);
    this.logger.debug(`Emitted ${topic}`);
  }
}
