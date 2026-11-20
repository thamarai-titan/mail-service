import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { IngestConfig } from './ingest-config.js';

/**
 * Redis for address lookups and for adding jobs. Commands fail at once while Redis is down
 * (no offline queue, one retry), so a delivery gets a temporary failure instead of hanging.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: IngestConfig) {
    super(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Connection failures arrive as an AggregateError with an empty message, so fall back to the code.
    this.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(`Redis: ${error.message || error.code || error.name}`),
    );
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
