import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { EventEnvelope, TopicName } from '@chainstrike/events';
import { randomUUID } from 'crypto';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);

  constructor(@Inject('KAFKA_PRODUCER') private readonly kafka: ClientKafka) {}

  async emit<T>(topic: TopicName, payload: T): Promise<void> {
    const envelope: EventEnvelope<T> = {
      eventId: randomUUID(),
      eventType: topic,
      source: 'identity-service',
      version: '1.0',
      timestamp: new Date().toISOString(),
      payload,
    };

    try {
      await this.kafka.emit(topic, { value: JSON.stringify(envelope) }).toPromise();
      this.logger.debug(`Emitted event: ${topic} (${envelope.eventId})`);
    } catch (error) {
      this.logger.error(`Failed to emit event ${topic}: ${error}`);
      // In production: persist to an outbox table for retry
      throw error;
    }
  }
}
