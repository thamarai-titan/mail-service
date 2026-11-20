import { Injectable, Logger } from '@nestjs/common';
import {
  addressKey,
  parseAddressEntry,
  serializeAddressEntry,
} from '@repo/queue';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';

export type Recipient =
  | { status: 'live'; inboxId: string; sessionId: string }
  | { status: 'expired' }
  | { status: 'unknown' };

/** Longest local part plus domain allowed by RFC 5321. */
const MAX_ADDRESS_LENGTH = 254;

/**
 * Decides whether mail for an address can be accepted (README E5). Redis answers for every
 * live address; PostgreSQL is asked when Redis has no entry or is down, which also tells an
 * expired inbox apart from one that never existed. Throws only when both are unreachable.
 */
@Injectable()
export class RecipientResolver {
  private readonly logger = new Logger(RecipientResolver.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(rawAddress: string): Promise<Recipient> {
    const address = rawAddress.trim().toLowerCase();
    if (address.length > MAX_ADDRESS_LENGTH || !address.includes('@')) {
      return { status: 'unknown' };
    }

    try {
      const entry = parseAddressEntry(
        await this.redis.hgetall(addressKey(address)),
      );
      if (entry && entry.expiresAt.getTime() > Date.now()) {
        return {
          status: 'live',
          inboxId: entry.inboxId,
          sessionId: entry.sessionId,
        };
      }
    } catch (error) {
      this.logger.warn(
        `Redis lookup failed, asking PostgreSQL: ${(error as Error).message}`,
      );
    }

    const inbox = await this.prisma.inbox.findUnique({
      where: { address },
      select: { id: true, sessionId: true, status: true, expiresAt: true },
    });
    if (!inbox) return { status: 'unknown' };
    if (inbox.status !== 'active' || inbox.expiresAt.getTime() <= Date.now()) {
      return { status: 'expired' };
    }
    // Live in PostgreSQL but missing from Redis (flushed or restarted): put it back.
    await this.restore(address, inbox.id, inbox.sessionId, inbox.expiresAt);
    return { status: 'live', inboxId: inbox.id, sessionId: inbox.sessionId };
  }

  private async restore(
    address: string,
    inboxId: string,
    sessionId: string,
    expiresAt: Date,
  ): Promise<void> {
    const key = addressKey(address);
    try {
      await this.redis
        .multi()
        .hset(key, serializeAddressEntry({ inboxId, sessionId, expiresAt }))
        .pexpireat(key, expiresAt.getTime())
        .exec();
    } catch {
      // Redis is down; the next lookup asks PostgreSQL again.
    }
  }
}
