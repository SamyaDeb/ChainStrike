import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Topics } from '@chainstrike/events';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);
  private readonly notificationServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.notificationServiceUrl = this.config.get<string>(
      'NOTIFICATION_SERVICE_URL',
      'http://localhost:3006',
    );
  }

  async emit<T>(topic: string, payload: T): Promise<void> {
    this.logger.debug(`Emitting event ${topic}`);

    try {
      switch (topic) {
        case Topics.ASSET_LP_TOKENS_READY:
          // Push notification to issuer: LP tokens are in vault, opt in to claim
          await axios.post(`${this.notificationServiceUrl}/notifications/push`, {
            topic,
            payload,
            timestamp: new Date().toISOString(),
          }, { timeout: 3000 });
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
