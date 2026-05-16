import { Injectable, Logger } from '@nestjs/common';
import { EventEnvelope } from '@chainstrike/types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly recentEvents: Array<{ topic: string; timestamp: string; payload: unknown }> = [];

  handle(topic: string, envelope: EventEnvelope<unknown>) {
    this.recentEvents.unshift({
      topic,
      timestamp: envelope.timestamp,
      payload: envelope.payload,
    });
    if (this.recentEvents.length > 100) {
      this.recentEvents.length = 100;
    }

    this.logger.log(`Notification event ${topic} received`);
  }

  getRecent() {
    return this.recentEvents;
  }
}
