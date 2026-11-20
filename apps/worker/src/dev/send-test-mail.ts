// Development helper: sends one email to an inbox.
// Usage: pnpm mail:test <address> [path/to/message.eml] [--lmtp]
// Without a file it sends a sample with an OTP, an inline image and two attachments.
// By default the raw .eml goes to object storage and a job straight onto the queue, so only
// the worker needs to run. With --lmtp it is delivered to the ingest app over LMTP instead,
// the way Postfix delivers real mail.
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
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

const args = process.argv.slice(2);
const viaLmtp = args.includes('--lmtp');
const [address, emlPath] = args.filter((arg) => !arg.startsWith('--'));
if (!address) {
  console.error(
    'Usage: pnpm mail:test <inbox address> [path/to/message.eml] [--lmtp]',
  );
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

/**
 * Delivers over LMTP like Postfix: one command at a time, waiting for each reply, and returns
 * the reply to the message itself.
 */
async function sendOverLmtp(raw: Buffer): Promise<string> {
  const port = Number(process.env['INGEST_LMTP_PORT'] ?? 2525);
  const socket = connect(port, process.env['INGEST_HOST'] ?? '127.0.0.1');
  socket.setEncoding('utf8');
  let buffer = '';
  const pending: ((line: string) => void)[] = [];
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      // Only the last line of a multi-line reply ("250 ", not "250-") completes it.
      if (/^\d{3} /.test(line)) pending.shift()?.(line);
    }
  });
  const reply = () =>
    new Promise<string>((done, fail) => {
      pending.push(done);
      socket.once('error', fail);
    });
  const step = async (command: string, expected: RegExp) => {
    socket.write(`${command}\r\n`);
    const line = await reply();
    if (!expected.test(line)) throw new Error(`${command}: ${line}`);
    return line;
  };

  try {
    const greeting = await reply();
    if (!greeting.startsWith('220')) throw new Error(greeting);
    await step('LHLO localhost', /^250/);
    await step('MAIL FROM:<sender@example.com>', /^250/);
    await step(`RCPT TO:<${address}>`, /^250/);
    await step('DATA', /^354/);
    const body = raw
      .toString('utf8')
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');
    socket.write(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
    const result = await reply();
    socket.write('QUIT\r\n');
    return result;
  } finally {
    socket.end();
  }
}

// pnpm runs this from apps/worker; INIT_CWD is where the command was typed.
const raw = emlPath
  ? readFileSync(resolve(process.env['INIT_CWD'] ?? '.', emlPath))
  : Buffer.from(sampleMessage(address));

if (viaLmtp) {
  try {
    console.log(`Ingest replied: ${await sendOverLmtp(raw)}`);
  } catch (error) {
    console.error(`LMTP delivery failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
} else {
  await queueDirectly(raw);
}

async function queueDirectly(raw: Buffer): Promise<void> {
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
      return;
    }
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
  } finally {
    await queue.close();
    connection.disconnect();
    storage.destroy();
    await prisma.$disconnect();
  }
}
