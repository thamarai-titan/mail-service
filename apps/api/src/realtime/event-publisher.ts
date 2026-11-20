import { Injectable, Logger } from '@nestjs/common';
import { sessionChannel, type SessionEvent } from '@repo/events';
import { RedisService } from '../redis/redis.service.js';

/** Publishes events to a session's open dashboards, in every API process. */
@Injectable()
export class EventPublisher {
  private readonly logger = new Logger(EventPublisher.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Best effort: the change it announces is already saved, and a dashboard that misses the
   * event catches up when its stream reconnects.
   */
  async publish(sessionId: string, event: SessionEvent): Promise<void> {
    try {
      await this.redis.publish(
        sessionChannel(sessionId),
        JSON.stringify(event),
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish ${event.type}: ${(error as Error).message}`,
      );
    }
  }
}
