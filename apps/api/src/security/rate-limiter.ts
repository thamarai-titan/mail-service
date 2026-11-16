import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

// Counts the hit and starts the window on the first one, atomically.
const HIT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {hits, redis.call('TTL', KEYS[1])}
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

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    try {
      const [hits, ttl] = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        `rl:${key}`,
        windowSeconds,
      )) as [number, number];
      return { allowed: hits <= limit, retryAfterSeconds: Math.max(ttl, 1) };
    } catch (error) {
      // Redis being down must not take the API down with it; Nginx still rate limits by IP.
      this.logger.warn(
        `Rate limit check skipped for ${key}: ${(error as Error).message}`,
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
