import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service.js';
import { StorageService } from '../core/storage.service.js';
import { BATCH_SIZE, MAX_BATCHES_PER_RUN } from './maintenance-settings.js';

/**
 * message-cleanup: deletes the messages of inboxes that expired or were deleted, together
 * with their raw files and attachments in object storage. The inbox rows stay until their
 * session is deleted.
 */
@Injectable()
export class MessageCleanup {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async run(now = new Date()): Promise<{ messages: number; objects: number }> {
    let messages = 0;
    let objects = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const rows = await this.prisma.message.findMany({
        where: {
          inbox: {
            OR: [{ status: { not: 'active' } }, { expiresAt: { lte: now } }],
          },
        },
        select: {
          id: true,
          rawObjectKey: true,
          attachments: { select: { storageKey: true } },
        },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;

      // Files first: if the run stops between the two steps, the rows are still there and
      // the next run deletes the (already missing) files again without harm.
      const keys = rows.flatMap((row) => [
        row.rawObjectKey,
        ...row.attachments.flatMap((a) => (a.storageKey ? [a.storageKey] : [])),
      ]);
      await this.storage.deleteMany(keys);
      // Attachments and events cascade with the message.
      const { count } = await this.prisma.message.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      messages += count;
      objects += keys.length;

      if (rows.length < BATCH_SIZE) break;
    }
    return { messages, objects };
  }
}
