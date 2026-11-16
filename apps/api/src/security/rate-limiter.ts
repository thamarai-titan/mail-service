import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

// Adds the cost and starts the window if the key has none, atomically.
const HIT_SCRIPT = `
local used = redis.call('INCRBY', KEYS[1], ARGV[2])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {used, redis.call('TTL', KEYS[1])}
`;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/** Fixed-window counters in Redis under `rl:*`. */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(private readonly redis: RedisService) {}

  /** Spends `cost` units of the key's budget. A refused hit still counts against the window. */
  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
    cost = 1,
  ): Promise<RateLimitResult> {
    try {
      const [used, ttl] = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        `rl:${key}`,
        windowSeconds,
        cost,
      )) as [number, number];
      return { allowed: used <= limit, retryAfterSeconds: Math.max(ttl, 1) };
    } catch (error) {
      // Redis being down must not take the API down with it; Nginx still rate limits by IP.
      this.logger.warn(
        `Rate limit check skipped for ${key}: ${(error as Error).message}`,
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
