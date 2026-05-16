import { Injectable, Logger } from '@nestjs/common';

// Stub: event broadcasting now done via WebSocket gateway and direct HTTP calls.
// Keeping this class as a no-op so existing imports don't break during migration.
@Injectable()
export class EventProducerService {
  private readonly logger = new Logger(EventProducerService.name);

  async emit<T>(topic: string, _payload: T): Promise<void> {
    this.logger.debug(`Event ${topic} (no-op — replaced by inline HTTP/WS calls)`);
  }
}
