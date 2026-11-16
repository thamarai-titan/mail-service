import { Global, Module } from '@nestjs/common';
import { Hasher } from './hasher.js';
import { RateLimiter } from './rate-limiter.js';

@Global()
@Module({
  providers: [Hasher, RateLimiter],
  exports: [Hasher, RateLimiter],
})
export class SecurityModule {}
