import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { RedisService } from './../src/redis/redis.service.js';

interface Inbox {
  id: string;
  address: string;
}

interface Summary {
  id: string;
  inboxId: string;
  inboxAddress: string;
  subject: string | null;
  preview: string;
  isRead: boolean;
  attachmentCount: number;
  otpCode: string | null;
}

interface Page {
  messages: Summary[];
  nextCursor: string | null;
}

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('Messages (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  const createdSessionIds: string[] = [];

  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /** A fresh session that already owns `inboxCount` inboxes. */
  async function newSession(inboxCount = 1) {
    await resetRateLimits();
    const created = await request(app.getHttpServer())
      .post('/api/sessions')
      .expect(201);
    createdSessionIds.push((created.body as { sessionId: string }).sessionId);
    const cookie = (
      created.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    const response = await request(app.getHttpServer())
      .post('/api/inboxes')
      .set('Cookie', cookie)
      .send({ count: inboxCount })
      .expect(201);
    return { cookie, inboxes: (response.body as { inboxes: Inbox[] }).inboxes };
  }

  /** Stores a message directly, standing in for the worker. `receivedAt` accepts microseconds. */
  async function deliver(
    inbox: Inbox,
    fields: {
      subject?: string;
      receivedAt?: string;
      textBody?: string;
      htmlSanitized?: string;
      otpCode?: string;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const { receivedAt, ...rest } = fields;
    await prisma.message.create({
      data: {
        id,
        inboxId: inbox.id,
        dedupeHash: id,
        fromAddress: 'sender@example.com',
        fromName: 'Sender',
        sizeBytes: 123n,
        rawObjectKey: `raw/${id}.eml`,
        ...rest,
      },
    });
    if (receivedAt) {
      await prisma.$executeRaw`
        UPDATE messages SET received_at = ${receivedAt}::timestamptz WHERE id = ${id}::uuid`;
    }
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: { messageCount: { increment: 1 } },
    });
    return id;
  }

  const get = (cookie: string, path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);

  async function list(cookie: string, query = ''): Promise<Page> {
    const response = await get(cookie, `/api/messages${query}`).expect(200);
    return response.body as Page;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    const inboxes = await prisma.inbox.findMany({
      where: { sessionId: { in: createdSessionIds } },
      select: { address: true },
    });
    if (inboxes.length > 0) {
      await redis.del(...inboxes.map((inbox) => `addr:${inbox.address}`));
    }
    await prisma.anonymousSession.deleteMany({
      where: { id: { in: createdSessionIds } },
    });
    await resetRateLimits();
    await app.close();
  });

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/messages').expect(401);
  });

  it('returns an empty page when nothing has arrived', async () => {
    const { cookie } = await newSession();

    expect(await list(cookie)).toEqual({ messages: [], nextCursor: null });
  });

  it('merges every inbox of the session, newest first, naming the receiving address', async () => {
    const { cookie, inboxes } = await newSession(3);
    const [a, b, c] = inboxes as [Inbox, Inbox, Inbox];
    const oldest = await deliver(a, { receivedAt: '2026-01-01T10:00:00Z' });
    const newest = await deliver(b, { receivedAt: '2026-01-01T12:00:00Z' });
    const middle = await deliver(c, { receivedAt: '2026-01-01T11:00:00Z' });

    const page = await list(cookie, '?view=unified');

    expect(page.messages.map((message) => message.id)).toEqual([
      newest,
      middle,
      oldest,
    ]);
    expect(page.messages.map((message) => message.inboxAddress)).toEqual([
      b.address,
      c.address,
      a.address,
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('summarises each message: collapsed preview, OTP, read state, attachment count', async () => {
    const { cookie, inboxes } = await newSession();
    const id = await deliver(inboxes[0]!, {
      subject: 'Your code',
      textBody: `Hello,\n\n   your   code is 482913.\n${'x'.repeat(500)}`,
      otpCode: '482913',
    });
    await prisma.attachment.createMany({
      data: ['a.pdf', 'b.png'].map((filename) => ({
        messageId: id,
        filename,
        contentType: 'application/octet-stream',
        sizeBytes: 10n,
      })),
    });

    const [summary] = (await list(cookie)).messages;

    expect(summary).toMatchObject({
      id,
      subject: 'Your code',
      otpCode: '482913',
      isRead: false,
      attachmentCount: 2,
      fromAddress: 'sender@example.com',
      fromName: 'Sender',
    });
    expect(summary!.preview).toHaveLength(140);
    expect(summary!.preview.startsWith('Hello, your code is 482913. xxx')).toBe(
      true,
    );
  });

  it('pages through messages with no repeats or gaps, even when timestamps tie or differ by microseconds', async () => {
    const { cookie, inboxes } = await newSession(2);
    const expected: string[] = [];
    const times = [
      '2026-02-01T10:00:00.000003Z',
      '2026-02-01T10:00:00.000002Z',
      '2026-02-01T10:00:00.000001Z',
      '2026-02-01T10:00:00.000000Z',
      '2026-02-01T09:00:00.000000Z',
    ];
    for (const [index, receivedAt] of times.entries()) {
      expected.push(await deliver(inboxes[index % 2]!, { receivedAt }));
    }
    // Three more sharing one instant: only the id can order these.
    const tied: string[] = [];
    for (let i = 0; i < 3; i++) {
      tied.push(
        await deliver(inboxes[i % 2]!, { receivedAt: '2026-02-01T08:00:00Z' }),
      );
    }
    expected.push(...tied.sort().reverse());

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page = await list(
        cookie,
        `?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.messages.map((message) => message.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
  });

  it('returns 50 per page by default', async () => {
    const { cookie, inboxes } = await newSession();
    await prisma.message.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        inboxId: inboxes[0]!.id,
        dedupeHash: `bulk-${index}`,
        fromAddress: 'sender@example.com',
        sizeBytes: 1n,
        rawObjectKey: `raw/bulk-${index}`,
      })),
    });

    const first = await list(cookie);
    const second = await list(cookie, `?cursor=${first.nextCursor}`);

    expect(first.messages).toHaveLength(50);
    expect(second.messages).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('filters to one inbox', async () => {
    const { cookie, inboxes } = await newSession(2);
    const [a, b] = inboxes as [Inbox, Inbox];
    await deliver(a);
    const inB = await deliver(b);

    const page = await list(cookie, `?inboxId=${b.id}`);

    expect(page.messages.map((message) => message.id)).toEqual([inB]);
  });

  it('hides messages of expired and deleted inboxes', async () => {
    const { cookie, inboxes } = await newSession(3);
    const [kept, expired, deleted] = inboxes as [Inbox, Inbox, Inbox];
    const visible = await deliver(kept);
    const inExpired = await deliver(expired);
    const inDeleted = await deliver(deleted);
    await prisma.inbox.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .delete(`/api/inboxes/${deleted.id}`)
      .set('Cookie', cookie)
      .expect(204);

    expect((await list(cookie)).messages.map((message) => message.id)).toEqual([
      visible,
    ]);
    await get(cookie, `/api/messages?inboxId=${expired.id}`).expect(404);
    await get(cookie, `/api/messages/${inExpired}`).expect(404);
    await get(cookie, `/api/messages/${inDeleted}`).expect(404);
  });

  it.each([
    '?view=everything',
    '?inboxId=nope',
    '?limit=0',
    '?limit=51',
    '?cursor=garbage',
    '?view=unified&inboxId=00000000-0000-4000-8000-000000000000',
  ])('rejects the query %s with 400', async (query) => {
    const { cookie } = await newSession();

    const response = await get(cookie, `/api/messages${query}`).expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('opens a message with its bodies and attachments, and marks it read', async () => {
    const { cookie, inboxes } = await newSession();
    const inbox = inboxes[0]!;
    const id = await deliver(inbox, {
      subject: 'Invoice',
      textBody: 'See attached.',
      htmlSanitized: '<p>See attached.</p>',
    });
    await prisma.attachment.createMany({
      data: [
        {
          messageId: id,
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048n,
          storageKey: 'att/x',
        },
        {
          messageId: id,
          filename: 'virus.exe',
          contentType: 'application/x-msdownload',
          sizeBytes: 99n,
          isBlocked: true,
        },
      ],
    });

    const response = await get(cookie, `/api/messages/${id}`).expect(200);

    expect(response.body).toMatchObject({
      id,
      inboxId: inbox.id,
      inboxAddress: inbox.address,
      subject: 'Invoice',
      textBody: 'See attached.',
      htmlSanitized: '<p>See attached.</p>',
      isRead: true,
      sizeBytes: 123,
      attachments: [
        {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          isBlocked: false,
        },
        { filename: 'virus.exe', sizeBytes: 99, isBlocked: true },
      ],
    });
    // Storage keys are internal: downloads will go through their own endpoint.
    expect(JSON.stringify(response.body)).not.toContain('att/x');
    expect((await list(cookie)).messages[0]!.isRead).toBe(true);
  });

  it("lowers the inbox's unread count when a message is opened", async () => {
    const { cookie, inboxes } = await newSession();
    const first = await deliver(inboxes[0]!);
    await deliver(inboxes[0]!);
    const unread = async () =>
      (
        (await get(cookie, '/api/inboxes').expect(200)).body as {
          inboxes: { unreadCount: number }[];
        }
      ).inboxes[0]!.unreadCount;
    expect(await unread()).toBe(2);

    await get(cookie, `/api/messages/${first}`).expect(200);

    expect(await unread()).toBe(1);
  });

  it('deletes a message and its attachments, and lowers the inbox message count', async () => {
    const { cookie, inboxes } = await newSession();
    const id = await deliver(inboxes[0]!);
    const kept = await deliver(inboxes[0]!);
    await prisma.attachment.create({
      data: {
        messageId: id,
        filename: 'a.txt',
        contentType: 'text/plain',
        sizeBytes: 1n,
      },
    });

    await request(app.getHttpServer())
      .delete(`/api/messages/${id}`)
      .set('Cookie', cookie)
      .expect(204);

    expect((await list(cookie)).messages.map((message) => message.id)).toEqual([
      kept,
    ]);
    expect(await prisma.attachment.count({ where: { messageId: id } })).toBe(0);
    const inbox = await prisma.inbox.findUniqueOrThrow({
      where: { id: inboxes[0]!.id },
    });
    expect(inbox.messageCount).toBe(1);
    await request(app.getHttpServer())
      .delete(`/api/messages/${id}`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it("keeps one session's messages invisible and untouchable to another", async () => {
    const owner = await newSession();
    const intruder = await newSession();
    const id = await deliver(owner.inboxes[0]!, { subject: 'Private' });

    expect((await list(intruder.cookie)).messages).toHaveLength(0);
    for (const attempt of [
      get(intruder.cookie, `/api/messages/${id}`),
      get(intruder.cookie, `/api/messages?inboxId=${owner.inboxes[0]!.id}`),
      request(app.getHttpServer())
        .delete(`/api/messages/${id}`)
        .set('Cookie', intruder.cookie),
    ]) {
      const response = await attempt.expect(404);
      expect((response.body as { code: string }).code).toBe('NOT_FOUND');
    }

    const [stillThere] = (await list(owner.cookie)).messages;
    expect(stillThere).toMatchObject({ id, isRead: false });
  });

  it('answers 404 for a message id that is not a UUID', async () => {
    const { cookie } = await newSession();

    await get(cookie, '/api/messages/not-a-uuid').expect(404);
  });
});
