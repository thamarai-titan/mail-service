import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';

/** The shared Redis connection for cache and address lookups. Reconnects automatically. */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: AppConfig) {
    // Fail commands quickly while Redis is unreachable so callers can fall back to PostgreSQL
    // instead of holding the request open through 20 reconnect attempts.
    super(config.redisUrl, { maxRetriesPerRequest: 1 });
    // Without a listener ioredis prints every reconnect failure as an unhandled error event.
    // Connection failures arrive as an AggregateError with an empty message, so fall back to the code.
    this.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(`Redis: ${error.message || error.code || error.name}`),
    );
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
