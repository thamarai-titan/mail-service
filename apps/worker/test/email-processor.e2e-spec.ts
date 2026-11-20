import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { EmailProcessingJob } from '@repo/queue';
import { objectKeys } from '@repo/storage';
import { Redis } from 'ioredis';
import { CoreModule } from '../src/core/core.module.js';
import { PrismaService } from '../src/core/prisma.service.js';
import { StorageService } from '../src/core/storage.service.js';
import { WorkerConfig } from '../src/core/worker-config.js';
import { EmailProcessor } from '../src/processing/email-processor.js';

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('EmailProcessor (e2e)', () => {
  let processor: EmailProcessor;
  let prisma: PrismaService;
  let storage: StorageService;
  let close: () => Promise<void>;
  let subscriber: Redis;
  const published: string[] = [];
  const sessionIds: string[] = [];

  /** A new session with one live inbox. */
  async function newInbox() {
    const domain = await prisma.domain.findFirstOrThrow({
      where: { isActive: true },
    });
    const session = await prisma.anonymousSession.create({
      data: {
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    sessionIds.push(session.id);
    const localPart = randomBytes(6).toString('hex');
    return prisma.inbox.create({
      data: {
        sessionId: session.id,
        domainId: domain.id,
        localPart,
        address: `${localPart}@${domain.name}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  }

  /** Uploads a raw message and returns the job the ingest app would queue for it. */
  async function queued(
    inbox: { id: string; sessionId: string },
    raw: string,
  ): Promise<EmailProcessingJob> {
    const rawObjectKey = objectKeys.raw(randomUUID());
    await storage.put(rawObjectKey, Buffer.from(raw), 'message/rfc822');
    return {
      inboxId: inbox.id,
      sessionId: inbox.sessionId,
      rawObjectKey,
      dedupeHash: randomBytes(32).toString('hex'),
      receivedAt: new Date().toISOString(),
    };
  }

  const simpleMail = (subject: string, body: string) =>
    [
      'From: "Shop" <shop@example.com>',
      'To: someone@mail.localhost',
      `Subject: ${subject}`,
      `Message-ID: <${randomUUID()}@example.com>`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
      '--b',
      'Content-Type: text/plain; name="a.txt"',
      'Content-Disposition: attachment; filename="a.txt"',
      '',
      'attached text',
      '--b',
      'Content-Type: application/octet-stream; name="run.bat"',
      'Content-Disposition: attachment; filename="run.bat"',
      '',
      'echo hi',
      '--b--',
      '',
    ].join('\r\n');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule],
      providers: [EmailProcessor],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    close = () => app.close();
    processor = app.get(EmailProcessor);
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    subscriber = new Redis(app.get(WorkerConfig).redisUrl);
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

  it('stores a message with sanitized HTML, attachments, OTP and events, then announces it', async () => {
    const inbox = await newInbox();
    const job = await queued(
      inbox,
      simpleMail(
        'Welcome',
        '<p>Your verification code is <b>604412</b></p><script>steal()</script>',
      ),
    );

    const outcome = await processor.process(job);

    expect(outcome.status).toBe('stored');
    const messageId = (outcome as { messageId: string }).messageId;
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { attachments: { orderBy: { filename: 'asc' } }, events: true },
    });
    expect(message).toMatchObject({
      fromAddress: 'shop@example.com',
      fromName: 'Shop',
      subject: 'Welcome',
      otpCode: '604412',
      htmlSanitized: '<p>Your verification code is <b>604412</b></p>',
      textBody: 'Your verification code is 604412',
      rawObjectKey: job.rawObjectKey,
    });
    expect(
      message.attachments.map((a) => [
        a.filename,
        a.isBlocked,
        a.storageKey !== null,
      ]),
    ).toEqual([
      ['a.txt', false, true],
      ['run.bat', true, false],
    ]);
    const stored = await storage.get(message.attachments[0]!.storageKey!);
    expect(stored?.toString()).toBe('attached text');
    expect(message.events.map((e) => e.eventType).sort()).toEqual([
      'OTP_EXTRACTED',
      'RECEIVED',
    ]);
    expect(
      (await prisma.inbox.findUniqueOrThrow({ where: { id: inbox.id } }))
        .messageCount,
    ).toBe(1);

    await vi.waitFor(() =>
      expect(published.map((m) => JSON.parse(m) as unknown)).toContainEqual({
        type: 'NEW_EMAIL',
        eventId: message.events
          .find((e) => e.eventType === 'RECEIVED')!
          .id.toString(),
        inboxId: inbox.id,
        messageId,
      }),
    );
  });

  it('stores a second delivery of the same message only once', async () => {
    const inbox = await newInbox();
    const job = await queued(inbox, simpleMail('Twice', '<p>Hello</p>'));

    expect((await processor.process(job)).status).toBe('stored');
    expect((await processor.process(job)).status).toBe('duplicate');

    expect(await prisma.message.count({ where: { inboxId: inbox.id } })).toBe(
      1,
    );
    const events = await prisma.emailEvent.findMany({
      where: { inboxId: inbox.id, eventType: 'DUPLICATE' },
    });
    expect(events).toHaveLength(1);
  });

  it('discards mail for an inbox that expired after the mail was accepted', async () => {
    const inbox = await newInbox();
    const job = await queued(inbox, simpleMail('Late', '<p>Too late</p>'));
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await processor.process(job)).status).toBe('inbox-gone');

    expect(await prisma.message.count({ where: { inboxId: inbox.id } })).toBe(
      0,
    );
    expect(await storage.get(job.rawObjectKey)).toBeNull();
  });

  it('does not deliver to an inbox of a different session', async () => {
    const inbox = await newInbox();
    const other = await newInbox();
    const job = await queued(
      { id: inbox.id, sessionId: other.sessionId },
      simpleMail('Wrong', '<p>x</p>'),
    );

    expect((await processor.process(job)).status).toBe('inbox-gone');
    expect(await prisma.message.count({ where: { inboxId: inbox.id } })).toBe(
      0,
    );
  });

  it('fails without retrying when the raw message is missing', async () => {
    const inbox = await newInbox();
    const job: EmailProcessingJob = {
      inboxId: inbox.id,
      sessionId: inbox.sessionId,
      rawObjectKey: objectKeys.raw(randomUUID()),
      dedupeHash: randomBytes(32).toString('hex'),
      receivedAt: new Date().toISOString(),
    };

    await expect(processor.process(job)).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });
  });
});
