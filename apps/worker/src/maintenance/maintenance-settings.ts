/** Schedules and limits of the maintenance jobs (README section 8). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Rows changed per statement, so no run holds a lock on a large part of a table. */
export const BATCH_SIZE = 500;
/** Batches per run. Anything left over is picked up by the next run. */
export const MAX_BATCHES_PER_RUN = 40;

/** An expired session's row (and its inboxes and events) is deleted this long after it expired. */
export const SESSION_RETENTION_MS = 7 * DAY;

/**
 * A stored object that no row refers to is deleted once it is this old. Younger ones may
 * belong to a message that is still being processed.
 */
export const ORPHAN_OBJECT_MIN_AGE_MS = DAY;
/** Mail that could not be parsed is kept this long for diagnosis. */
export const QUARANTINE_RETENTION_MS = 7 * DAY;

/** failed-job-retry puts a dead-letter job back on the queue at most this many times. */
export const MAX_REPLAYS = 3;
/** Dead-letter entries are dropped after this long, retried or not. */
export const DEAD_LETTER_RETENTION_MS = 7 * DAY;

/** When each job runs. `every` is in milliseconds; `pattern` is cron in UTC. */
export const SCHEDULES = {
  inboxExpiration: { every: MINUTE },
  sessionExpiration: { every: 15 * MINUTE },
  messageCleanup: { every: HOUR },
  attachmentCleanup: { pattern: '0 3 * * *' },
  failedJobRetry: { every: 10 * MINUTE },
} as const;
