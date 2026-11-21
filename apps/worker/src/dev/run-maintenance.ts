/**
 * Runs one maintenance job now instead of waiting for its schedule. The running worker
 * (`pnpm dev`) picks the job up and logs what it did.
 *
 *   pnpm maintenance:run message-cleanup
 */
import { QUEUE_NAMES } from '@repo/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // Missing file: fall back to the process environment.
  }
}

const JOBS: readonly string[] = [
  QUEUE_NAMES.inboxExpiration,
  QUEUE_NAMES.sessionExpiration,
  QUEUE_NAMES.messageCleanup,
  QUEUE_NAMES.attachmentCleanup,
  QUEUE_NAMES.failedJobRetry,
];

const name = process.argv[2];
if (!name || !JOBS.includes(name)) {
  console.error(`Usage: pnpm maintenance:run <${JOBS.join(' | ')}>`);
  process.exit(1);
}

const connection = new Redis(process.env['REDIS_URL'] ?? '', {
  maxRetriesPerRequest: null,
});
const queue = new Queue(name, { connection });
try {
  await queue.add('manual', {}, { removeOnComplete: true, removeOnFail: 50 });
  console.log(
    `Queued ${name}. The worker logs the result if it changed anything.`,
  );
} finally {
  await queue.close();
  connection.disconnect();
}
