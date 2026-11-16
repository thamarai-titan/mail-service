import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

export interface RegisteredAddress {
  address: string;
  inboxId: string;
  sessionId: string;
  expiresAt: Date;
}

export const addressKey = (address: string) => `addr:${address}`;

/**
 * Redis index of live addresses (`addr:ADDRESS`), read by the SMTP recipient check.
 * PostgreSQL stays the source of truth, so a failed write here is logged, not fatal.
 */
@Injectable()
export class AddressRegistry {
  private readonly logger = new Logger(AddressRegistry.name);

  constructor(private readonly redis: RedisService) {}

  /** Adds or refreshes entries. Each key expires together with its inbox. */
  async register(entries: RegisteredAddress[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const entry of entries) {
      const key = addressKey(entry.address);
      pipeline.hset(key, {
        inboxId: entry.inboxId,
        sessionId: entry.sessionId,
        expiresAt: entry.expiresAt.getTime(),
      });
      pipeline.pexpireat(key, entry.expiresAt.getTime());
    }
    await this.run('register', () => pipeline.exec());
  }

  async remove(address: string): Promise<void> {
    await this.run('remove', () => this.redis.del(addressKey(address)));
  }

  private async run(
    operation: string,
    command: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await command();
    } catch (error) {
      this.logger.warn(
        `Address registry ${operation} failed: ${(error as Error).message}`,
      );
    }
  }
}
