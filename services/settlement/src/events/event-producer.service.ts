import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Topics } from '@chainstrike/events';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);
  private readonly orderbookServiceUrl: string;
  private readonly internalHeaders: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    this.orderbookServiceUrl = this.config.get<string>(
      'ORDERBOOK_SERVICE_URL',
      'http://localhost:3003',
    );
    this.internalHeaders = {
      'x-internal-secret': this.config.get<string>('INTERNAL_SECRET', ''),
    };
  }

  async emit<T>(topic: string, payload: T): Promise<void> {
    this.logger.debug(`Emitting event ${topic} via HTTP`);

    try {
      switch (topic) {
        case Topics.TRADE_SETTLED:
          await axios.post(
            `${this.orderbookServiceUrl}/internal/trades/settled`,
            payload,
            { timeout: 3000, headers: this.internalHeaders },
          );
          break;
        case Topics.SETTLEMENT_FAILED:
          await axios.post(
            `${this.orderbookServiceUrl}/internal/trades/failed`,
            payload,
            { timeout: 3000, headers: this.internalHeaders },
          );
          break;
        default:
          this.logger.debug(`No HTTP handler for topic ${topic}`);
      }
    } catch (err) {
      this.logger.warn(`Event HTTP delivery failed for ${topic}: ${(err as Error).message}`);
    }
  }
}
