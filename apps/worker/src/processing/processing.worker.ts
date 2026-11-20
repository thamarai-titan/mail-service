import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma.service.js';
import { WorkerConfig } from '../core/worker-config.js';
import {
  QUEUE_NAMES,
  type DeadLetterJob,
  type EmailProcessingJob,
} from '@repo/queue';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailProcessor, type ProcessingOutcome } from './email-processor.js';

/**
 * Runs {@link EmailProcessor} for every job on the email-processing queue. Retries come from
 * the job options set at enqueue time; a job that runs out of attempts, or fails in a way a
 * retry cannot fix, is copied to the dead-letter queue and logged as a FAILED event.
 */
@Injectable()
export class ProcessingWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ProcessingWorker.name);
  private connection: Redis | undefined;
  private worker: Worker<EmailProcessingJob, ProcessingOutcome> | undefined;
  private deadLetters: Queue<DeadLetterJob> | undefined;

  constructor(
    private readonly config: WorkerConfig,
    private readonly processor: EmailProcessor,
    private readonly prisma: PrismaService,
  ) {}

  // Started after every module is ready, so the bucket exists before the first job arrives.
  onApplicationBootstrap(): void {
    // BullMQ needs maxRetriesPerRequest: null so its blocking commands are never cut short.
    this.connection = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(`Redis: ${error.message || error.code || error.name}`),
    );
    this.deadLetters = new Queue(QUEUE_NAMES.emailProcessingDlq, {
      connection: this.connection,
    });
    this.worker = new Worker(
      QUEUE_NAMES.emailProcessing,
      (job) => this.processor.process(job.data),
      { connection: this.connection, concurrency: this.config.concurrency },
    );
    this.worker.on('completed', (job, outcome) =>
      this.logger.log(`Job ${job.id}: ${outcome.status}`),
    );
    this.worker.on('failed', (job, error) => {
      if (job) void this.handleFailure(job, error);
    });
    this.worker.on('error', (error) =>
      this.logger.error(`Worker error: ${error.message}`),
    );
    this.logger.log(
      `Processing ${QUEUE_NAMES.emailProcessing} with concurrency ${this.config.concurrency}`,
    );
  }

  /** Waits for jobs in progress to finish, then closes the connections. */
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.deadLetters?.close();
    this.connection?.disconnect();
  }

  private async handleFailure(
    job: Job<EmailProcessingJob, ProcessingOutcome>,
    error: Error,
  ): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const final =
      error.name === 'UnrecoverableError' || job.attemptsMade >= attempts;
    if (!final) {
      this.logger.warn(
        `Job ${job.id} attempt ${job.attemptsMade}/${attempts} failed, will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(`Job ${job.id} failed for good: ${error.message}`);
    try {
      await this.deadLetters!.add(
        'dead-letter',
        {
          queue: QUEUE_NAMES.emailProcessing,
          jobId: job.id,
          data: job.data,
          failedReason: error.message,
          attemptsMade: job.attemptsMade,
          failedAt: new Date().toISOString(),
        },
        { jobId: job.id, removeOnComplete: true, removeOnFail: false },
      );
    } catch (dlqError) {
      this.logger.error(
        `Could not move job ${job.id} to the dead-letter queue: ${(dlqError as Error).message}`,
      );
    }
    try {
      await this.prisma.emailEvent.create({
        data: {
          inboxId: job.data.inboxId,
          eventType: 'FAILED',
          payload: {
            jobId: job.id ?? null,
            rawObjectKey: job.data.rawObjectKey,
            reason: error.message.slice(0, 500),
          },
        },
      });
    } catch {
      // The inbox may be gone; the dead-letter entry still has everything.
    }
  }
}
