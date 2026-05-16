import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Topics } from '@chainstrike/events';
import type { TopicName } from '@chainstrike/events';

@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);
  private readonly complianceServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.complianceServiceUrl = this.config.get<string>(
      'COMPLIANCE_SERVICE_URL',
      'http://localhost:3004',
    );
  }

  async emit<T>(topic: TopicName, payload: T): Promise<void> {
    this.logger.debug(`Emitting event ${topic} via HTTP`);

    try {
      switch (topic) {
        case Topics.KYC_VERIFIED:
          await axios.post(
            `${this.complianceServiceUrl}/internal/whitelist/add`,
            payload,
            { timeout: 3000 },
          );
          break;
        case Topics.KYC_EXPIRED:
          await axios.post(
            `${this.complianceServiceUrl}/internal/whitelist/remove`,
            payload,
            { timeout: 3000 },
          );
          break;
        default:
          this.logger.debug(`No HTTP handler for topic ${topic}`);
      }
    } catch (err) {
      this.logger.warn(`Event HTTP delivery failed for ${topic}: ${(err as Error).message}`);
      // Don't throw — primary action already completed
    }
  }
}
