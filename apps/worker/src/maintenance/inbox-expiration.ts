import { Injectable } from '@nestjs/common';
import { EVENT_TYPES, sessionChannel, type SessionEvent } from '@repo/events';
import { addressKey } from '@repo/queue';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';
import { BATCH_SIZE, MAX_BATCHES_PER_RUN } from './maintenance-settings.js';

/**
 * inbox-expiration: marks inboxes whose time is up as expired, stops mail to their addresses
 * and tells the owning session's dashboards to drop them.
 */
@Injectable()
export class InboxExpiration {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async run(now = new Date()): Promise<{ expired: number }> {
    let expired = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const inboxes = await this.prisma.inbox.updateManyAndReturn({
        where: { status: 'active', expiresAt: { lte: now } },
        data: { status: 'expired' },
        select: { id: true, sessionId: true, address: true },
        limit: BATCH_SIZE,
      });
      if (inboxes.length === 0) break;
      expired += inboxes.length;

      // The address keys expire on their own; deleting them covers keys whose expiry was
      // never set or was pushed out by an extension racing this job.
      const pipeline = this.redis.pipeline();
      pipeline.del(...inboxes.map((inbox) => addressKey(inbox.address)));
      for (const inbox of inboxes) {
        const event: SessionEvent = {
          type: EVENT_TYPES.inboxExpired,
          eventId: null,
          inboxId: inbox.id,
        };
        pipeline.publish(
          sessionChannel(inbox.sessionId),
          JSON.stringify(event),
        );
      }
      await pipeline.exec();

      if (inboxes.length < BATCH_SIZE) break;
    }
    return { expired };
  }
}
