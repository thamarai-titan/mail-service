import { createHash } from 'node:crypto';

export * from './addresses.js';

/** BullMQ queue names shared by the ingest and worker apps (README section 8). */
export const QUEUE_NAMES = {
  emailProcessing: 'email-processing',
  emailProcessingDlq: 'email-processing-dlq',
  otpExtraction: 'otp-extraction',
  inboxExpiration: 'inbox-expiration',
  sessionExpiration: 'session-expiration',
  messageCleanup: 'message-cleanup',
  attachmentCleanup: 'attachment-cleanup',
  failedJobRetry: 'failed-job-retry',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * One received message waiting to be stored. The raw .eml is already in object storage;
 * the worker reads and parses it from there, so the job stays small and can be replayed.
 */
export interface EmailProcessingJob {
  inboxId: string;
  sessionId: string;
  /** Object key of the raw .eml (`raw/<id>.eml`). */
  rawObjectKey: string;
  /** From {@link computeDedupeHash}. */
  dedupeHash: string;
  /** When the mail server accepted the message, ISO 8601. */
  receivedAt: string;
}

/** A job that used up its attempts, copied to the dead-letter queue for inspection or replay. */
export interface DeadLetterJob {
  queue: QueueName;
  jobId: string | undefined;
  data: EmailProcessingJob;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

/** Options for every email-processing job: 5 attempts, backoff 2s, 4s, 8s, 16s. */
export const EMAIL_PROCESSING_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/**
 * BullMQ job id for a message. The same message delivered twice while the first copy is
 * still queued gets the same id and is not queued again. BullMQ ids cannot contain ':'.
 */
export const emailProcessingJobId = (job: EmailProcessingJob): string =>
  `${job.inboxId}.${job.dedupeHash}`;

/**
 * SHA-256 of the Message-ID header and the message body (README E13). Header lines added in
 * transit are left out, so the same message relayed twice hashes the same.
 */
export function computeDedupeHash(parts: {
  messageId: string | undefined;
  text: string | undefined;
  html: string | false | undefined;
}): string {
  return createHash('sha256')
    .update(parts.messageId ?? '')
    .update('\0')
    .update(parts.text ?? '')
    .update('\0')
    .update(parts.html || '')
    .digest('hex');
}
