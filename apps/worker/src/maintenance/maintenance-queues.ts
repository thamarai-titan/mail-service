import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  QUEUE_NAMES,
  type DeadLetterJob,
  type EmailProcessingJob,
} from '@repo/queue';
import { Queue, type JobType } from 'bullmq';
import { Redis } from 'ioredis';
import { WorkerConfig } from '../core/worker-config.js';

/** Job states in which a processing job may still read its raw file. */
const PENDING_STATES: JobType[] = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
  'failed',
];

/**
 * The queues the maintenance jobs inspect, plus the Redis connection that every maintenance
 * queue and worker shares. BullMQ needs `maxRetriesPerRequest: null` for its blocking commands.
 */
@Injectable()
export class MaintenanceQueues implements OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceQueues.name);
  readonly connection: Redis;
  readonly emailProcessing: Queue<EmailProcessingJob>;
  readonly deadLetters: Queue<DeadLetterJob>;

  constructor(config: WorkerConfig) {
    this.connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(`Redis: ${error.message || error.code || error.name}`),
    );
    this.emailProcessing = new Queue(QUEUE_NAMES.emailProcessing, {
      connection: this.connection,
    });
    this.deadLetters = new Queue(QUEUE_NAMES.emailProcessingDlq, {
      connection: this.connection,
    });
  }

  /**
   * Raw files that queued, retrying or dead-letter jobs still point to. The storage sweep
   * must not delete them even when no message row refers to them yet.
   */
  async rawKeysInUse(): Promise<Set<string>> {
    const [pending, dead] = await Promise.all([
      this.emailProcessing.getJobs(PENDING_STATES),
      this.deadLetters.getJobs(['waiting']),
    ]);
    const keys = new Set<string>();
    for (const job of pending) {
      if (job?.data?.rawObjectKey) keys.add(job.data.rawObjectKey);
    }
    for (const job of dead) {
      if (job?.data?.data?.rawObjectKey) keys.add(job.data.data.rawObjectKey);
    }
    return keys;
  }

  async onModuleDestroy(): Promise<void> {
    await this.emailProcessing.close();
    await this.deadLetters.close();
    this.connection.disconnect();
  }
}
