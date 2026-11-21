import { Injectable } from '@nestjs/common';
import { addressKey } from '@repo/queue';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';
import {
  BATCH_SIZE,
  MAX_BATCHES_PER_RUN,
  SESSION_RETENTION_MS,
} from './maintenance-settings.js';

/**
 * session-expiration: marks idle sessions expired along with their live inboxes, and deletes
 * sessions that expired more than {@link SESSION_RETENTION_MS} ago. Deleting a session
 * cascades to its inboxes, messages, attachments and events; message-cleanup has removed
 * their stored files long before.
 */
@Injectable()
export class SessionExpiration {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async run(
    now = new Date(),
  ): Promise<{ expired: number; inboxesExpired: number; deleted: number }> {
    let expired = 0;
    let inboxesExpired = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const sessions = await this.prisma.anonymousSession.updateManyAndReturn({
        where: { status: 'active', expiresAt: { lte: now } },
        data: { status: 'expired' },
        select: { id: true },
        limit: BATCH_SIZE,
      });
      if (sessions.length === 0) break;
      expired += sessions.length;

      // Nobody can open these inboxes any more, so stop accepting mail for them now rather
      // than when each one's own time runs out.
      const inboxes = await this.prisma.inbox.updateManyAndReturn({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          status: 'active',
        },
        data: { status: 'expired' },
        select: { address: true },
      });
      inboxesExpired += inboxes.length;
      if (inboxes.length > 0) {
        await this.redis.del(
          ...inboxes.map((inbox) => addressKey(inbox.address)),
        );
      }

      if (sessions.length < BATCH_SIZE) break;
    }

    let deleted = 0;
    const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      // Any session this far past its expiry is gone, whether or not it was ever marked.
      const { count } = await this.prisma.anonymousSession.deleteMany({
        where: { expiresAt: { lte: cutoff } },
        limit: BATCH_SIZE,
      });
      deleted += count;
      if (count < BATCH_SIZE) break;
    }

    return { expired, inboxesExpired, deleted };
  }
}
