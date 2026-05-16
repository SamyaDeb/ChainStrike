import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Topics } from '@chainstrike/events';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);
  private readonly orderbookServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.orderbookServiceUrl = this.config.get<string>(
      'ORDERBOOK_SERVICE_URL',
      'http://localhost:3003',
    );
  }

  async emit<T>(topic: string, payload: T): Promise<void> {
    this.logger.debug(`Emitting event ${topic}`);

    try {
      switch (topic) {
        case Topics.ASSET_CREATED:
          // Notify orderbook service to create a market for the new asset
          await axios.post(`${this.orderbookServiceUrl}/internal/markets`, payload, { timeout: 3000 });
          break;
        case Topics.ASSET_STATUS_CHANGED:
          await axios.post(`${this.orderbookServiceUrl}/internal/markets/status`, payload, { timeout: 3000 });
          break;
        default:
          this.logger.debug(`No HTTP handler for topic ${topic}, skipping`);
      }
    } catch (err) {
      this.logger.warn(`Event HTTP delivery failed for ${topic}: ${(err as Error).message}`);
      // Don't throw — event delivery is best-effort; primary action already completed
    }
  }
}
