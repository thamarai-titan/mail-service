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
