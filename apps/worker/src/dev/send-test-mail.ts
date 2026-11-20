// Development helper: queues one email for an inbox the way the ingest app will (Day 8): the
// raw .eml goes to object storage, then a job goes on the email-processing queue.
// Usage: pnpm mail:test <address> [path/to/message.eml]
// Without a file it sends a sample with an OTP, an inline image and two attachments.
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '@repo/database';
import {
  computeDedupeHash,
  EMAIL_PROCESSING_JOB_OPTIONS,
  emailProcessingJobId,
  QUEUE_NAMES,
  type EmailProcessingJob,
} from '@repo/queue';
import { ObjectStorage, objectKeys, storageConfigFromEnv } from '@repo/storage';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { simpleParser } from 'mailparser';

for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // Missing file: fall back to the process environment.
  }
}

const [address, emlPath] = process.argv.slice(2);
if (!address) {
  console.error('Usage: pnpm mail:test <inbox address> [path/to/message.eml]');
  process.exit(1);
}

/** A 1x1 PNG, referenced from the HTML by Content-ID. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sampleMessage(to: string): string {
  const otp = String(randomInt(100000, 1000000));
  const id = randomUUID();
  const notes = Buffer.from(
    'These are the notes from the test message.\n',
  ).toString('base64');
  return [
    'From: "Test Sender" <sender@example.com>',
    `To: ${to}`,
    `Subject: Your verification code is ${otp}`,
    `Message-ID: <${id}@example.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mixed"',
    '',
    '--mixed',
    'Content-Type: multipart/related; boundary="related"',
    '',
    '--related',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Your verification code is ${otp}. It expires in 10 minutes.`,
    '',
    '--alt',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<p style="font-size:18px">Your verification code is <strong>${otp}</strong>.</p>`,
    '<p><img src="cid:pixel@example.com" alt="inline pixel" width="16" height="16"></p>',
    '<p onclick="alert(1)">This paragraph had an onclick handler.</p>',
    '<script>alert("this script must not survive")</script>',
    '<p><a href="https://example.com/docs">A link</a> and a <img src="https://example.com/track.gif" alt="remote image"></p>',
    '',
    '--alt--',
    '',
    '--related',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <pixel@example.com>',
    'Content-Disposition: inline; filename="pixel.png"',
    '',
    PIXEL,
    '',
    '--related--',
    '',
    '--mixed',
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="notes.txt"',
    '',
    notes,
    '',
    '--mixed',
    'Content-Type: application/x-msdownload; name="setup.exe"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="setup.exe"',
    '',
    Buffer.from('MZ not really an executable').toString('base64'),
    '',
    '--mixed--',
    '',
  ].join('\r\n');
}

const prisma = createPrismaClient();
const storage = new ObjectStorage(storageConfigFromEnv());
const connection = new Redis(process.env['REDIS_URL'] ?? '', {
  maxRetriesPerRequest: null,
});
const queue = new Queue<EmailProcessingJob>(QUEUE_NAMES.emailProcessing, {
  connection,
});

try {
  const inbox = await prisma.inbox.findUnique({
    where: { address },
    select: { id: true, sessionId: true, status: true, expiresAt: true },
  });
  if (!inbox || inbox.status !== 'active' || inbox.expiresAt <= new Date()) {
    console.error(`No active inbox with the address ${address}`);
    process.exitCode = 1;
  } else {
    // pnpm runs this from apps/worker; INIT_CWD is where the command was typed.
    const raw = emlPath
      ? readFileSync(resolve(process.env['INIT_CWD'] ?? '.', emlPath))
      : Buffer.from(sampleMessage(address));
    const parsed = await simpleParser(raw);

    await storage.ensureBucket();
    const rawObjectKey = objectKeys.raw(randomUUID());
    await storage.put(rawObjectKey, raw, 'message/rfc822');

    const data: EmailProcessingJob = {
      inboxId: inbox.id,
      sessionId: inbox.sessionId,
      rawObjectKey,
      dedupeHash: computeDedupeHash({
        messageId: parsed.messageId,
        text: parsed.text,
        html: parsed.html,
      }),
      receivedAt: new Date().toISOString(),
    };
    const job = await queue.add('email', data, {
      ...EMAIL_PROCESSING_JOB_OPTIONS,
      jobId: emailProcessingJobId(data),
    });
    console.log(
      `Queued job ${job.id} for ${address}: "${parsed.subject ?? '(no subject)'}" (${raw.length} bytes)`,
    );
  }
} finally {
  await queue.close();
  connection.disconnect();
  storage.destroy();
  await prisma.$disconnect();
}
