import { Injectable, Logger } from '@nestjs/common';
import { Topics } from '@chainstrike/events';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);

  async emit<T>(topic: string, payload: T): Promise<void> {
    this.logger.debug(`Emitting event ${topic}`);
    // Add new handlers here when a consumer is introduced.
    switch (topic) {
      case Topics.TRADE_SETTLED:
      case Topics.SETTLEMENT_FAILED:
        this.logger.debug(`No active handler for ${topic}`);
        break;
      default:
        this.logger.debug(`Unknown topic ${topic}`);
    }
  }
}
