import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  EMAIL_PROCESSING_JOB_OPTIONS,
  QUEUE_NAMES,
  addressKey,
  emailProcessingJobId,
  type DeadLetterJob,
  type EmailProcessingJob,
} from '@repo/queue';
import { objectKeys } from '@repo/storage';
import { Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { CoreModule } from '../src/core/core.module.js';
import { PrismaService } from '../src/core/prisma.service.js';
import { RedisService } from '../src/core/redis.service.js';
import { StorageService } from '../src/core/storage.service.js';
import { WorkerConfig } from '../src/core/worker-config.js';
import { FailedJobRetry } from '../src/maintenance/failed-job-retry.js';
import { InboxExpiration } from '../src/maintenance/inbox-expiration.js';
import { MaintenanceQueues } from '../src/maintenance/maintenance-queues.js';
import { MessageCleanup } from '../src/maintenance/message-cleanup.js';
import { SessionExpiration } from '../src/maintenance/session-expiration.js';
import { StorageCleanup } from '../src/maintenance/storage-cleanup.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
// Stop `pnpm dev` first: a running worker would take the queue jobs these tests create.
// The jobs act on the whole development database and bucket, as they would in production.
describe('Maintenance jobs (e2e)', () => {
  let prisma: PrismaService;
  let storage: StorageService;
  let redis: RedisService;
  let queues: MaintenanceQueues;
  let redisUrl: string;
  let close: () => Promise<void>;
  let subscriber: Redis;
  const published: string[] = [];
  const sessionIds: string[] = [];
  let app: Awaited<ReturnType<typeof createApp>>;

  async function createApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule],
      providers: [
        MaintenanceQueues,
        InboxExpiration,
        SessionExpiration,
        MessageCleanup,
        StorageCleanup,
        FailedJobRetry,
      ],
    }).compile();
    const nest = moduleRef.createNestApplication();
    await nest.init();
    return nest;
  }

  async function newSession(expiresAt = new Date(Date.now() + HOUR)) {
    const session = await prisma.anonymousSession.create({
      data: { tokenHash: randomBytes(32).toString('hex'), expiresAt },
    });
    sessionIds.push(session.id);
    return session;
  }

  async function newInbox(
    sessionId: string,
    expiresAt = new Date(Date.now() + HOUR),
  ) {
    const domain = await prisma.domain.findFirstOrThrow({
      where: { isActive: true },
    });
    const localPart = randomBytes(6).toString('hex');
    const inbox = await prisma.inbox.create({
      data: {
        sessionId,
        domainId: domain.id,
        localPart,
        address: `${localPart}@${domain.name}`,
        expiresAt,
      },
    });
    await redis.hset(addressKey(inbox.address), {
      inboxId: inbox.id,
      sessionId,
      expiresAt: String(expiresAt.getTime()),
    });
    return inbox;
  }

  /** A stored message with its raw file and one attachment file in storage. */
  async function newMessage(inboxId: string) {
    const rawObjectKey = objectKeys.raw(randomUUID());
    const dedupeHash = randomBytes(32).toString('hex');
    const attachmentKey = objectKeys.attachment(inboxId, dedupeHash, 0);
    await storage.put(rawObjectKey, Buffer.from('raw'), 'message/rfc822');
    await storage.put(attachmentKey, Buffer.from('file'), 'text/plain');
    const message = await prisma.message.create({
      data: {
        inboxId,
        dedupeHash,
        fromAddress: 'shop@example.com',
        sizeBytes: 3n,
        rawObjectKey,
        attachments: {
          create: {
            filename: 'a.txt',
            contentType: 'text/plain',
            sizeBytes: 4n,
            storageKey: attachmentKey,
          },
        },
        events: { create: { inboxId, eventType: 'RECEIVED' } },
      },
    });
    return { message, rawObjectKey, attachmentKey };
  }

  const exists = async (key: string) => (await storage.get(key)) !== null;

  function deadLetter(
    data: EmailProcessingJob,
    overrides: Partial<DeadLetterJob> = {},
  ): DeadLetterJob {
    return {
      queue: QUEUE_NAMES.emailProcessing,
      jobId: emailProcessingJobId(data),
      data,
      failedReason: 'database down',
      retryable: true,
      attemptsMade: 5,
      failedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function processingJob(
    inboxId: string,
    sessionId: string,
  ): EmailProcessingJob {
    return {
      inboxId,
      sessionId,
      rawObjectKey: objectKeys.raw(randomUUID()),
      dedupeHash: randomBytes(32).toString('hex'),
      receivedAt: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    app = await createApp();
    close = () => app.close();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    redis = app.get(RedisService);
    queues = app.get(MaintenanceQueues);
    redisUrl = app.get(WorkerConfig).redisUrl;

    subscriber = new Redis(redisUrl);
    await subscriber.psubscribe('events:session:*');
    subscriber.on('pmessage', (_pattern, _channel, message: string) =>
      published.push(message),
    );
  });

  afterAll(async () => {
    await prisma.anonymousSession.deleteMany({
      where: { id: { in: sessionIds } },
    });
    subscriber.disconnect();
    await close();
  });

  describe('inbox-expiration', () => {
    it('expires inboxes past their time, removes their addresses and announces it', async () => {
      const session = await newSession();
      const gone = await newInbox(session.id, new Date(Date.now() - 1000));
      const live = await newInbox(session.id);

      const result = await app.get(InboxExpiration).run();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(result.expired).toBeGreaterThanOrEqual(1);
      const rows = await prisma.inbox.findMany({
        where: { id: { in: [gone.id, live.id] } },
      });
      expect(rows.find((r) => r.id === gone.id)?.status).toBe('expired');
      expect(rows.find((r) => r.id === live.id)?.status).toBe('active');
      expect(await redis.exists(addressKey(gone.address))).toBe(0);
      expect(await redis.exists(addressKey(live.address))).toBe(1);
      expect(published.map((m) => JSON.parse(m) as object)).toContainEqual({
        type: 'INBOX_EXPIRED',
        eventId: null,
        inboxId: gone.id,
      });
    });
  });

  describe('message-cleanup', () => {
    it('deletes messages and files of expired and deleted inboxes only', async () => {
      const session = await newSession();
      const expired = await newInbox(session.id, new Date(Date.now() - 1000));
      const deleted = await newInbox(session.id);
      await prisma.inbox.update({
        where: { id: deleted.id },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      const live = await newInbox(session.id);
      const a = await newMessage(expired.id);
      const b = await newMessage(deleted.id);
      const c = await newMessage(live.id);

      const result = await app.get(MessageCleanup).run();

      expect(result.messages).toBeGreaterThanOrEqual(2);
      const left = await prisma.message.findMany({
        where: { id: { in: [a, b, c].map((m) => m.message.id) } },
        select: { id: true },
      });
      expect(left).toEqual([{ id: c.message.id }]);
      expect(
        await prisma.attachment.count({
          where: { messageId: { in: [a.message.id, b.message.id] } },
        }),
      ).toBe(0);
      for (const m of [a, b]) {
        expect(await exists(m.rawObjectKey)).toBe(false);
        expect(await exists(m.attachmentKey)).toBe(false);
      }
      expect(await exists(c.rawObjectKey)).toBe(true);
      expect(await exists(c.attachmentKey)).toBe(true);
      // Inbox rows stay until their session is deleted.
      expect(await prisma.inbox.count({ where: { id: expired.id } })).toBe(1);
    });
  });

  describe('session-expiration', () => {
    it('expires idle sessions with their inboxes and deletes long-expired ones', async () => {
      const idle = await newSession(new Date(Date.now() - 1000));
      const idleInbox = await newInbox(idle.id);
      const old = await newSession(new Date(Date.now() - 8 * DAY));
      const oldInbox = await newInbox(old.id, new Date(Date.now() - 8 * DAY));
      const oldMessage = await newMessage(oldInbox.id);
      const active = await newSession();
      const activeInbox = await newInbox(active.id);

      const result = await app.get(SessionExpiration).run();

      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.anonymousSession.findUnique({ where: { id: idle.id } }))
          ?.status,
      ).toBe('expired');
      expect(
        (await prisma.inbox.findUnique({ where: { id: idleInbox.id } }))
          ?.status,
      ).toBe('expired');
      expect(await redis.exists(addressKey(idleInbox.address))).toBe(0);

      expect(
        await prisma.anonymousSession.count({ where: { id: old.id } }),
      ).toBe(0);
      expect(await prisma.inbox.count({ where: { id: oldInbox.id } })).toBe(0);
      expect(
        await prisma.message.count({ where: { id: oldMessage.message.id } }),
      ).toBe(0);

      expect(
        (await prisma.anonymousSession.findUnique({ where: { id: active.id } }))
          ?.status,
      ).toBe('active');
      expect(
        (await prisma.inbox.findUnique({ where: { id: activeInbox.id } }))
          ?.status,
      ).toBe('active');

      // The deleted session's files are now orphans; the storage sweep removes them.
      await storage.deleteMany([
        oldMessage.rawObjectKey,
        oldMessage.attachmentKey,
      ]);
    });
  });

  describe('attachment-cleanup', () => {
    it('deletes old files nothing refers to and keeps the rest', async () => {
      const session = await newSession();
      const inbox = await newInbox(session.id);
      const kept = await newMessage(inbox.id);
      const orphanRaw = objectKeys.raw(randomUUID());
      const orphanAttachment = objectKeys.attachment(inbox.id, 'x', 0);
      const deadLetterRaw = objectKeys.raw(randomUUID());
      for (const key of [orphanRaw, orphanAttachment, deadLetterRaw]) {
        await storage.put(key, Buffer.from('x'), 'application/octet-stream');
      }
      const job = {
        ...processingJob(inbox.id, session.id),
        rawObjectKey: deadLetterRaw,
      };
      const entry = await queues.deadLetters.add(
        'dead-letter',
        deadLetter(job, { jobId: `test.${randomUUID()}` }),
      );

      const cleanup = app.get(StorageCleanup);
      // Young files are left alone: they may belong to mail still being processed.
      await cleanup.run();
      expect(await exists(orphanRaw)).toBe(true);
      expect(await exists(orphanAttachment)).toBe(true);

      const result = await cleanup.run(new Date(Date.now() + 25 * HOUR));

      expect(result.raw).toBeGreaterThanOrEqual(1);
      expect(result.attachments).toBeGreaterThanOrEqual(1);
      expect(await exists(orphanRaw)).toBe(false);
      expect(await exists(orphanAttachment)).toBe(false);
      expect(await exists(kept.rawObjectKey)).toBe(true);
      expect(await exists(kept.attachmentKey)).toBe(true);
      expect(await exists(deadLetterRaw)).toBe(true);

      await entry.remove();
      await storage.deleteMany([deadLetterRaw]);
    });
  });

  describe('failed-job-retry', () => {
    it('puts a retryable failed job back on the queue with fresh attempts', async () => {
      const session = await newSession();
      const inbox = await newInbox(session.id);
      const data = processingJob(inbox.id, session.id);
      const jobId = emailProcessingJobId(data);
      await queues.emailProcessing.add('email', data, {
        ...EMAIL_PROCESSING_JOB_OPTIONS,
        attempts: 1,
        jobId,
      });

      // Fail the job by hand, the way the processing worker would.
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      const worker = new Worker(QUEUE_NAMES.emailProcessing, null, {
        connection,
        autorun: false,
      });
      const token = randomUUID();
      const active = (await worker.getNextJob(token)) as Job | undefined;
      expect(active?.id).toBe(jobId);
      await active!.moveToFailed(new Error('database down'), token);
      await worker.close();
      connection.disconnect();
      expect(await queues.emailProcessing.getJobState(jobId)).toBe('failed');

      const entry = await queues.deadLetters.add(
        'dead-letter',
        deadLetter(data),
        { jobId },
      );

      const result = await app.get(FailedJobRetry).run();

      expect(result.replayed).toBeGreaterThanOrEqual(1);
      expect(await queues.emailProcessing.getJobState(jobId)).toBe('waiting');
      const retried = await Job.fromId<EmailProcessingJob>(
        queues.emailProcessing,
        jobId,
      );
      expect(retried?.data.replays).toBe(1);
      expect(retried?.attemptsMade).toBe(0);
      expect(await Job.fromId(queues.deadLetters, entry.id!)).toBeUndefined();

      await retried!.remove();
    });

    it('queues a fresh job when the failed one is gone', async () => {
      const session = await newSession();
      const inbox = await newInbox(session.id);
      const data = processingJob(inbox.id, session.id);
      await queues.deadLetters.add('dead-letter', deadLetter(data));

      await app.get(FailedJobRetry).run();

      const queued = await Job.fromId<EmailProcessingJob>(
        queues.emailProcessing,
        emailProcessingJobId(data),
      );
      expect(queued?.data).toMatchObject({
        rawObjectKey: data.rawObjectKey,
        replays: 1,
      });
      await queued!.remove();
    });

    it('leaves unrecoverable and over-replayed entries, and drops old ones', async () => {
      const session = await newSession();
      const inbox = await newInbox(session.id);
      const unrecoverable = await queues.deadLetters.add(
        'dead-letter',
        deadLetter(processingJob(inbox.id, session.id), { retryable: false }),
      );
      const exhausted = await queues.deadLetters.add(
        'dead-letter',
        deadLetter({ ...processingJob(inbox.id, session.id), replays: 3 }),
      );

      const job = app.get(FailedJobRetry);
      await job.run();
      expect(
        await Job.fromId(queues.deadLetters, unrecoverable.id!),
      ).toBeDefined();
      expect(await Job.fromId(queues.deadLetters, exhausted.id!)).toBeDefined();

      await job.run(new Date(Date.now() + 8 * DAY));
      expect(
        await Job.fromId(queues.deadLetters, unrecoverable.id!),
      ).toBeUndefined();
      expect(
        await Job.fromId(queues.deadLetters, exhausted.id!),
      ).toBeUndefined();
    });
  });
});
