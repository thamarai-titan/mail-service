import { Injectable } from '@nestjs/common';
import type { ListedObject } from '@repo/storage';
import { PrismaService } from '../core/prisma.service.js';
import { StorageService } from '../core/storage.service.js';
import { MaintenanceQueues } from './maintenance-queues.js';
import {
  ORPHAN_OBJECT_MIN_AGE_MS,
  QUARANTINE_RETENTION_MS,
} from './maintenance-settings.js';

export interface StorageCleanupResult {
  raw: number;
  attachments: number;
  quarantine: number;
}

/**
 * attachment-cleanup: removes files in object storage that nothing refers to. message-cleanup
 * deletes the files of every message it removes; this sweep catches the rest:
 * - raw copies of duplicates the queue skipped, or of mail whose job never ran;
 * - files of messages deleted one by one from the dashboard;
 * - files left by a run that stopped halfway;
 * - quarantined mail past its retention.
 */
@Injectable()
export class StorageCleanup {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: MaintenanceQueues,
  ) {}

  async run(now = new Date()): Promise<StorageCleanupResult> {
    const orphanCutoff = now.getTime() - ORPHAN_OBJECT_MIN_AGE_MS;
    const rawInUse = await this.queues.rawKeysInUse();

    const raw = await this.sweep('raw/', orphanCutoff, async (keys) => {
      const rows = await this.prisma.message.findMany({
        where: { rawObjectKey: { in: keys } },
        select: { rawObjectKey: true },
      });
      return new Set([
        ...rows.map((row) => row.rawObjectKey),
        ...keys.filter((key) => rawInUse.has(key)),
      ]);
    });

    const attachments = await this.sweep('att/', orphanCutoff, async (keys) => {
      const rows = await this.prisma.attachment.findMany({
        where: { storageKey: { in: keys } },
        select: { storageKey: true },
      });
      return new Set(
        rows.flatMap((row) => (row.storageKey ? [row.storageKey] : [])),
      );
    });

    const quarantine = await this.sweep(
      'quarantine/',
      now.getTime() - QUARANTINE_RETENTION_MS,
      async () => new Set<string>(),
    );

    return { raw, attachments, quarantine };
  }

  /** Deletes the objects under `prefix` older than `cutoff` that `inUse` does not claim. */
  private async sweep(
    prefix: string,
    cutoff: number,
    inUse: (keys: string[]) => Promise<Set<string>>,
  ): Promise<number> {
    let deleted = 0;
    for await (const page of this.storage.listPages(prefix)) {
      const old = page
        .filter(
          (object: ListedObject) => object.lastModified.getTime() <= cutoff,
        )
        .map((object) => object.key);
      if (old.length === 0) continue;
      const keep = await inUse(old);
      const orphans = old.filter((key) => !keep.has(key));
      await this.storage.deleteMany(orphans);
      deleted += orphans.length;
    }
    return deleted;
  }
}
