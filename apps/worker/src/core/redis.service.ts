import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { WorkerConfig } from './worker-config.js';

/**
 * Redis connection for publishing events. BullMQ opens its own connections, since it needs
 * `maxRetriesPerRequest: null` and blocking commands.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: WorkerConfig) {
    super(config.redisUrl, { maxRetriesPerRequest: 1 });
    // Connection failures arrive as an AggregateError with an empty message, so fall back to the code.
    this.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(`Redis: ${error.message || error.code || error.name}`),
    );
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
