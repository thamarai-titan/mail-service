import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { QUEUE_NAMES } from '@repo/queue';
import { Queue, Worker } from 'bullmq';
import { FailedJobRetry } from './failed-job-retry.js';
import { InboxExpiration } from './inbox-expiration.js';
import { MaintenanceQueues } from './maintenance-queues.js';
import { SCHEDULES } from './maintenance-settings.js';
import { MessageCleanup } from './message-cleanup.js';
import { SessionExpiration } from './session-expiration.js';
import { StorageCleanup } from './storage-cleanup.js';

interface MaintenanceJob {
  queue: string;
  schedule: { every: number } | { pattern: string };
  run: () => Promise<Record<string, number>>;
}

/**
 * Registers the maintenance jobs as BullMQ job schedulers and runs them. Each job has its own
 * queue and a worker with concurrency 1, so a slow run never overlaps the next one in the same
 * process. With several worker processes a job may run twice at once; every job is idempotent.
 */
@Injectable()
export class MaintenanceScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceScheduler.name);
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];

  constructor(
    private readonly shared: MaintenanceQueues,
    private readonly inboxExpiration: InboxExpiration,
    private readonly sessionExpiration: SessionExpiration,
    private readonly messageCleanup: MessageCleanup,
    private readonly storageCleanup: StorageCleanup,
    private readonly failedJobRetry: FailedJobRetry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const jobs: MaintenanceJob[] = [
      {
        queue: QUEUE_NAMES.inboxExpiration,
        schedule: SCHEDULES.inboxExpiration,
        run: () => this.inboxExpiration.run(),
      },
      {
        queue: QUEUE_NAMES.sessionExpiration,
        schedule: SCHEDULES.sessionExpiration,
        run: () => this.sessionExpiration.run(),
      },
      {
        queue: QUEUE_NAMES.messageCleanup,
        schedule: SCHEDULES.messageCleanup,
        run: () => this.messageCleanup.run(),
      },
      {
        queue: QUEUE_NAMES.attachmentCleanup,
        schedule: SCHEDULES.attachmentCleanup,
        run: async () => ({ ...(await this.storageCleanup.run()) }),
      },
      {
        queue: QUEUE_NAMES.failedJobRetry,
        schedule: SCHEDULES.failedJobRetry,
        run: async () => ({ ...(await this.failedJobRetry.run()) }),
      },
    ];

    for (const job of jobs) {
      const connection = this.shared.connection;
      const queue = new Queue(job.queue, { connection });
      this.queues.push(queue);
      // Upserting by name on every start keeps exactly one schedule per job, and picks up
      // a changed interval.
      await queue.upsertJobScheduler(job.queue, job.schedule, {
        name: job.queue,
        opts: {
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        },
      });

      const worker = new Worker(job.queue, () => job.run(), {
        connection,
        concurrency: 1,
      });
      worker.on('completed', (_job, result: Record<string, number>) => {
        // Quiet when there was nothing to do, which is most runs.
        if (Object.values(result).some((count) => count > 0)) {
          this.logger.log(`${job.queue}: ${JSON.stringify(result)}`);
        }
      });
      worker.on('failed', (_job, error) =>
        this.logger.error(`${job.queue} failed: ${error.message}`),
      );
      worker.on('error', (error) =>
        this.logger.error(`${job.queue} worker error: ${error.message}`),
      );
      this.workers.push(worker);
    }
    this.logger.log(`Scheduled ${jobs.map((job) => job.queue).join(', ')}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}
