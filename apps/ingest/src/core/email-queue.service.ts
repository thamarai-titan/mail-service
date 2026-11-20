import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  EMAIL_PROCESSING_JOB_OPTIONS,
  emailProcessingJobId,
  QUEUE_NAMES,
  type EmailProcessingJob,
} from '@repo/queue';
import { Queue } from 'bullmq';
import { RedisService } from './redis.service.js';

/** Longest wait for Redis to take a job before the delivery is deferred. */
const ENQUEUE_TIMEOUT_MS = 5000;

/** Adds jobs to the email-processing queue for the worker. */
@Injectable()
export class EmailQueue implements OnModuleDestroy {
  private readonly queue: Queue<EmailProcessingJob>;

  constructor(redis: RedisService) {
    // Adding jobs never blocks, so this queue can share the fail-fast connection.
    this.queue = new Queue(QUEUE_NAMES.emailProcessing, { connection: redis });
  }

  /** Rejects when Redis does not confirm in time; the caller answers 451 so Postfix retries. */
  async add(job: EmailProcessingJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Timed out adding the job')),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([
        this.queue.add('email', job, {
          ...EMAIL_PROCESSING_JOB_OPTIONS,
          jobId: emailProcessingJobId(job),
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
