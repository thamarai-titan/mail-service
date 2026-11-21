import { Injectable, Logger } from '@nestjs/common';
import {
  EMAIL_PROCESSING_JOB_OPTIONS,
  emailProcessingJobId,
  type DeadLetterJob,
} from '@repo/queue';
import { Job } from 'bullmq';
import { MaintenanceQueues } from './maintenance-queues.js';
import {
  DEAD_LETTER_RETENTION_MS,
  MAX_REPLAYS,
} from './maintenance-settings.js';

/** Dead-letter entries looked at per run. */
const ENTRIES_PER_RUN = 200;

export interface FailedJobRetryResult {
  replayed: number;
  dropped: number;
}

/**
 * failed-job-retry: puts dead-letter jobs back on the email-processing queue when their
 * failure may have been temporary, such as the database being down. Jobs that failed because
 * their raw file is missing or unparseable are left alone. Each job is replayed at most
 * {@link MAX_REPLAYS} times, and entries older than {@link DEAD_LETTER_RETENTION_MS} are dropped.
 */
@Injectable()
export class FailedJobRetry {
  private readonly logger = new Logger(FailedJobRetry.name);

  constructor(private readonly queues: MaintenanceQueues) {}

  async run(now = new Date()): Promise<FailedJobRetryResult> {
    const entries = await this.queues.deadLetters.getJobs(
      ['waiting'],
      0,
      ENTRIES_PER_RUN - 1,
    );
    let replayed = 0;
    let dropped = 0;
    for (const entry of entries) {
      if (!entry) continue;
      if (now.getTime() - entry.timestamp > DEAD_LETTER_RETENTION_MS) {
        await entry.remove();
        dropped++;
        continue;
      }
      const replays = entry.data.data.replays ?? 0;
      if (entry.data.retryable !== true || replays >= MAX_REPLAYS) continue;
      try {
        await this.replay(entry, replays + 1);
        replayed++;
      } catch (error) {
        this.logger.warn(
          `Could not replay dead-letter job ${entry.id}: ${(error as Error).message}`,
        );
      }
    }
    return { replayed, dropped };
  }

  private async replay(
    entry: Job<DeadLetterJob>,
    replays: number,
  ): Promise<void> {
    const dead = entry.data;
    const original = dead.jobId
      ? await Job.fromId(this.queues.emailProcessing, dead.jobId)
      : undefined;
    const state = original ? await original.getState() : 'missing';

    // The entry goes first: if the replayed job fails again, the processing worker adds a new
    // entry under the same id, which BullMQ would ignore while this one still existed.
    await entry.remove();
    try {
      if (original && state === 'failed') {
        await original.updateData({ ...original.data, replays });
        await original.retry('failed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
      } else if (state === 'missing' || state === 'unknown') {
        // The failed job has aged out of BullMQ; queue a fresh one from the saved data.
        const data = { ...dead.data, replays };
        await this.queues.emailProcessing.add('email', data, {
          ...EMAIL_PROCESSING_JOB_OPTIONS,
          jobId: emailProcessingJobId(data),
        });
      }
      // Any other state means the job is already queued again or done: nothing to do.
      this.logger.log(
        `Replayed job ${dead.jobId} (replay ${replays} of ${MAX_REPLAYS})`,
      );
    } catch (error) {
      await this.queues.deadLetters.add(entry.name, dead, entry.opts);
      throw error;
    }
  }
}
