import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Hasher } from '../security/hasher.js';
import { RateLimiter } from '../security/rate-limiter.js';
import { ApiError } from './session.errors.js';

export const SESSIONS_PER_IP_PER_HOUR = 5;

/** Redis key suffix (under `rl:`) counting session creations for one hashed IP. */
export const sessionCreationKey = (ipHash: string) => `sess-create:${ipHash}`;

/** Caps how many sessions one IP can create per hour. */
@Injectable()
export class SessionCreationLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiter,
    private readonly hasher: Hasher,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const ip = http.getRequest<Request>().ip ?? 'unknown';
    const { allowed, retryAfterSeconds } = await this.rateLimiter.hit(
      sessionCreationKey(this.hasher.hmac(ip)),
      SESSIONS_PER_IP_PER_HOUR,
      60 * 60,
    );
    if (!allowed) {
      http.getResponse<Response>().setHeader('Retry-After', retryAfterSeconds);
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many sessions created from this address. Try again later.',
      );
    }
    return true;
  }
}
