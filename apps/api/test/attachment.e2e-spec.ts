import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { RedisService } from './../src/redis/redis.service.js';
import { StorageService } from './../src/storage/storage.service.js';

interface Inbox {
  id: string;
  address: string;
}

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('Attachments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let storage: StorageService;
  const createdSessionIds: string[] = [];
  const storedKeys: string[] = [];

  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function newSession() {
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
      .send({ count: 1 })
      .expect(201);
    const inbox = (response.body as { inboxes: Inbox[] }).inboxes[0]!;
    return { cookie, inbox };
  }

  /** A message with one attachment, standing in for the worker. */
  async function deliverAttachment(
    inbox: Inbox,
    file: {
      filename: string;
      contentType: string;
      content?: string;
      blocked?: boolean;
    },
  ): Promise<string> {
    let storageKey: string | null = null;
    if (!file.blocked) {
      storageKey = `att/test/${randomUUID()}`;
      storedKeys.push(storageKey);
      await storage.put(
        storageKey,
        Buffer.from(file.content ?? ''),
        file.contentType,
      );
    }
    const messageId = randomUUID();
    const message = await prisma.message.create({
      data: {
        id: messageId,
        inboxId: inbox.id,
        dedupeHash: messageId,
        fromAddress: 'sender@example.com',
        sizeBytes: 100n,
        rawObjectKey: `raw/${messageId}.eml`,
        attachments: {
          create: {
            filename: file.filename,
            contentType: file.contentType,
            sizeBytes: BigInt(file.content?.length ?? 0),
            storageKey,
            isBlocked: file.blocked ?? false,
          },
        },
      },
      select: { attachments: { select: { id: true } } },
    });
    return message.attachments[0]!.id;
  }

  const download = (cookie: string, id: string) =>
    request(app.getHttpServer())
      .get(`/api/attachments/${id}/download`)
      .set('Cookie', cookie);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    storage = app.get(StorageService);
    await storage.ensureBucket();
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
    await Promise.all(storedKeys.map((key) => storage.delete(key)));
    await resetRateLimits();
    await app.close();
  });

  it('downloads the file as an attachment that the browser will not sniff or render', async () => {
    const { cookie, inbox } = await newSession();
    const id = await deliverAttachment(inbox, {
      filename: 'résumé "final".pdf',
      contentType: 'application/pdf',
      content: '%PDF-1.4 test',
    });

    const response = await download(cookie, id)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect((response.body as Buffer).toString()).toBe('%PDF-1.4 test');
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-length']).toBe('13');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="resume _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('serves HTML attachments as a download, not a page', async () => {
    const { cookie, inbox } = await newSession();
    const id = await deliverAttachment(inbox, {
      filename: 'page.html',
      contentType: 'text/html',
      content: '<script>alert(1)</script>',
    });

    const response = await download(cookie, id).expect(200);

    expect(response.headers['content-disposition']).toMatch(/^attachment;/);
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('refuses blocked attachments', async () => {
    const { cookie, inbox } = await newSession();
    const id = await deliverAttachment(inbox, {
      filename: 'setup.exe',
      contentType: 'application/x-msdownload',
      blocked: true,
    });

    const response = await download(cookie, id).expect(403);
    expect(response.body).toMatchObject({ code: 'ATTACHMENT_BLOCKED' });
  });

  it("hides another session's attachment and malformed ids behind the same 404", async () => {
    const owner = await newSession();
    const other = await newSession();
    const id = await deliverAttachment(owner.inbox, {
      filename: 'a.txt',
      contentType: 'text/plain',
      content: 'secret',
    });

    await download(other.cookie, id).expect(404);
    await download(other.cookie, 'not-a-uuid').expect(404);
    await download(owner.cookie, randomUUID()).expect(404);
  });

  it('requires a session', async () => {
    await request(app.getHttpServer())
      .get(`/api/attachments/${randomUUID()}/download`)
      .expect(401);
  });
});
