import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';

/** The shared Redis connection for cache and address lookups. Reconnects automatically. */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: AppConfig) {
    super(config.redisUrl);
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
