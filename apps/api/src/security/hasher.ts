import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';

/** Keyed hashing for values that must be matched but never stored raw (session tokens, client IPs). */
@Injectable()
export class Hasher {
  constructor(private readonly config: AppConfig) {}

  hmac(value: string): string {
    return createHmac('sha256', this.config.serverPepper)
      .update(value)
      .digest('hex');
  }
}
