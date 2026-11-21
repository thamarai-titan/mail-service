import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AddressGenerator } from './../src/inbox/address-generator.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { RedisService } from './../src/redis/redis.service.js';

interface InboxBody {
  id: string;
  address: string;
  createdAt: string;
  expiresAt: string;
  messageCount: number;
  unreadCount: number;
}

const HOUR_MS = 60 * 60 * 1000;

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('Inboxes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let generator: AddressGenerator;
  const createdSessionIds: string[] = [];

  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /** A fresh anonymous session, as the cookie header to send. */
  async function newSession(): Promise<{ id: string; cookie: string }> {
    await resetRateLimits();
    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .expect(201);
    const id = (response.body as { sessionId: string }).sessionId;
    createdSessionIds.push(id);
    const setCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0]!;
    return { id, cookie: setCookie.split(';')[0]! };
  }

  const post = (cookie: string, body?: object) =>
    request(app.getHttpServer())
      .post('/api/inboxes')
      .set('Cookie', cookie)
      .send(body);

  async function createInboxes(cookie: string, count: number) {
    const response = await post(cookie, { count }).expect(201);
    return (response.body as { inboxes: InboxBody[] }).inboxes;
  }

  async function listInboxes(cookie: string) {
    const response = await request(app.getHttpServer())
      .get('/api/inboxes')
      .set('Cookie', cookie)
      .expect(200);
    return (response.body as { inboxes: InboxBody[] }).inboxes;
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
    generator = app.get(AddressGenerator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    const response = await request(app.getHttpServer())
      .get('/api/inboxes')
      .expect(401);
    expect((response.body as { code: string }).code).toBe('NO_SESSION');
  });

  it('creates one inbox by default, on the seeded domain, expiring in an hour', async () => {
    const { cookie } = await newSession();

    const response = await post(cookie).expect(201);
    const [inbox] = (response.body as { inboxes: InboxBody[] }).inboxes;

    const domain = await prisma.domain.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(inbox!.address).toMatch(
      new RegExp(`^[a-km-np-z2-9]{12}@${domain.name.replaceAll('.', '\\.')}$`),
    );
    const lifetime = new Date(inbox!.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(HOUR_MS - 5000);
    expect(lifetime).toBeLessThanOrEqual(HOUR_MS);
    expect(inbox).toMatchObject({ messageCount: 0, unreadCount: 0 });
  });

  it('creates several at once and lists them newest first', async () => {
    const { cookie } = await newSession();
    const [first] = await createInboxes(cookie, 1);

    const bulk = await createInboxes(cookie, 5);

    expect(new Set(bulk.map((inbox) => inbox.address)).size).toBe(5);
    // The create response is already in list order, so the sidebar never reshuffles.
    expect((await listInboxes(cookie)).slice(0, 5)).toEqual(bulk);
    const listed = await listInboxes(cookie);
    expect(listed).toHaveLength(6);
    expect(listed.at(-1)).toEqual(first);
    expect(listed.map((inbox) => inbox.id).sort()).toEqual(
      [first!, ...bulk].map((inbox) => inbox.id).sort(),
    );
  });

  it('registers each address in Redis, expiring with the inbox', async () => {
    const { id: sessionId, cookie } = await newSession();

    const [inbox] = await createInboxes(cookie, 1);

    const key = `addr:${inbox!.address}`;
    expect(await redis.hgetall(key)).toEqual({
      inboxId: inbox!.id,
      sessionId,
      expiresAt: String(new Date(inbox!.expiresAt).getTime()),
    });
    const ttlSeconds = await redis.ttl(key);
    expect(ttlSeconds).toBeGreaterThan(3590);
    expect(ttlSeconds).toBeLessThanOrEqual(3600);
  });

  it.each([{ count: 0 }, { count: 6 }, { count: '2' }, { domainId: 'nope' }])(
    'rejects the invalid body %j with 400',
    async (body) => {
      const { cookie } = await newSession();

      const response = await post(cookie, body).expect(400);

      expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
      expect(await listInboxes(cookie)).toHaveLength(0);
    },
  );

  it('answers 422 for a domain that does not exist or is inactive', async () => {
    const { cookie } = await newSession();
    const inactive = await prisma.domain.create({
      data: { name: `inactive-${Date.now()}.test`, isActive: false },
    });

    try {
      for (const domainId of [
        inactive.id,
        '00000000-0000-4000-8000-000000000000',
      ]) {
        const response = await post(cookie, { domainId }).expect(422);
        expect((response.body as { code: string }).code).toBe(
          'DOMAIN_UNAVAILABLE',
        );
      }
    } finally {
      await prisma.domain.delete({ where: { id: inactive.id } });
    }
  });

  it('refuses to exceed 10 active inboxes and reports the remaining slots, creating none', async () => {
    const { cookie } = await newSession();
    await createInboxes(cookie, 5);
    await createInboxes(cookie, 3);

    const response = await post(cookie, { count: 3 }).expect(409);

    expect(response.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      remaining: 2,
    });
    expect(await listInboxes(cookie)).toHaveLength(8);
    await createInboxes(cookie, 2);
  });

  it('holds the quota under concurrent requests', async () => {
    const { cookie } = await newSession();

    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => post(cookie, { count: 5 })),
    );

    const statuses = responses
      .map((response) => response.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([201, 201, 409, 409]);
    expect(await listInboxes(cookie)).toHaveLength(10);
  });

  it('frees a quota slot when an inbox is deleted or has expired', async () => {
    const { cookie } = await newSession();
    const first = await createInboxes(cookie, 5);
    const second = await createInboxes(cookie, 5);
    await post(cookie).expect(409);

    await request(app.getHttpServer())
      .delete(`/api/inboxes/${first[0]!.id}`)
      .set('Cookie', cookie)
      .expect(204);
    await prisma.inbox.update({
      where: { id: second[0]!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await createInboxes(cookie, 2);
    await post(cookie).expect(409);
  });

  it('draws a new address when a generated one is already taken', async () => {
    const { cookie } = await newSession();
    const [existing] = await createInboxes(cookie, 1);
    const taken = existing!.address.split('@')[0]!;
    const draws = [taken, 'freshaddress', taken, 'secondfresh2'];
    const original = generator.localPart.bind(generator);
    vi.spyOn(generator, 'localPart').mockImplementation(
      () => draws.shift() ?? original(),
    );

    const created = await createInboxes(cookie, 2);

    const localParts = created.map((inbox) => inbox.address.split('@')[0]);
    expect(localParts).toContain('freshaddress');
    expect(localParts).not.toContain(taken);
    expect(localParts).toHaveLength(2);
    expect(await listInboxes(cookie)).toHaveLength(3);
  });

  it('gives up cleanly, creating nothing, when every draw collides', async () => {
    const { cookie } = await newSession();
    const [existing] = await createInboxes(cookie, 1);
    const taken = existing!.address.split('@')[0]!;
    vi.spyOn(generator, 'localPart').mockReturnValue(taken);

    await post(cookie, { count: 2 }).expect(500);

    expect(await listInboxes(cookie)).toHaveLength(1);
  });

  it('hides expired and deleted inboxes from the list', async () => {
    const { cookie } = await newSession();
    const [kept, expired, deleted] = await createInboxes(cookie, 3);
    await prisma.inbox.update({
      where: { id: expired!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .delete(`/api/inboxes/${deleted!.id}`)
      .set('Cookie', cookie)
      .expect(204);

    expect((await listInboxes(cookie)).map((inbox) => inbox.id)).toEqual([
      kept!.id,
    ]);
  });

  it('counts unread messages per inbox', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);
    const message = (dedupeHash: string, isRead: boolean) => ({
      inboxId: inbox!.id,
      dedupeHash,
      fromAddress: 'sender@example.com',
      sizeBytes: 10n,
      rawObjectKey: `raw/${dedupeHash}`,
      isRead,
    });
    await prisma.message.createMany({
      data: [message('a', false), message('b', false), message('c', true)],
    });

    const [listed] = await listInboxes(cookie);

    expect(listed!.unreadCount).toBe(2);
  });

  it('soft-deletes an inbox and unregisters its address', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);

    await request(app.getHttpServer())
      .delete(`/api/inboxes/${inbox!.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const row = await prisma.inbox.findUniqueOrThrow({
      where: { id: inbox!.id },
    });
    expect(row.status).toBe('deleted');
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(await redis.exists(`addr:${inbox!.address}`)).toBe(0);
    await request(app.getHttpServer())
      .delete(`/api/inboxes/${inbox!.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('extends by an hour and moves the Redis expiry with it', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);

    const response = await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .expect(200);

    const extended = response.body as InboxBody;
    expect(new Date(extended.expiresAt).getTime()).toBe(
      new Date(inbox!.expiresAt).getTime() + HOUR_MS,
    );
    expect(await redis.hget(`addr:${inbox!.address}`, 'expiresAt')).toBe(
      String(new Date(extended.expiresAt).getTime()),
    );
    expect(await redis.ttl(`addr:${inbox!.address}`)).toBeGreaterThan(7000);
  });

  it('never extends past 24 hours after creation', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);
    const createdAt = new Date(Date.now() - 23.5 * HOUR_MS);
    await prisma.inbox.update({
      where: { id: inbox!.id },
      data: { createdAt, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .expect(200);

    expect(new Date((response.body as InboxBody).expiresAt).getTime()).toBe(
      createdAt.getTime() + 24 * HOUR_MS,
    );
  });

  it('keeps an inbox until a chosen number of hours from now', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);

    const before = Date.now();
    const response = await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .send({ hours: 12 })
      .expect(200);

    const expiresAt = new Date(
      (response.body as InboxBody).expiresAt,
    ).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 12 * HOUR_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 12 * HOUR_MS);
    expect(await redis.hget(`addr:${inbox!.address}`, 'expiresAt')).toBe(
      String(expiresAt),
    );
  });

  it('caps a chosen duration at 24 hours after creation and never shortens', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);
    const createdAt = new Date(Date.now() - 20 * HOUR_MS);
    const expiresAt = new Date(Date.now() + 2 * HOUR_MS);
    await prisma.inbox.update({
      where: { id: inbox!.id },
      data: { createdAt, expiresAt },
    });

    const capped = await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .send({ hours: 24 })
      .expect(200);
    expect(new Date((capped.body as InboxBody).expiresAt).getTime()).toBe(
      createdAt.getTime() + 24 * HOUR_MS,
    );

    const unchanged = await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .send({ hours: 1 })
      .expect(200);
    expect(new Date((unchanged.body as InboxBody).expiresAt).getTime()).toBe(
      createdAt.getTime() + 24 * HOUR_MS,
    );

    await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .send({ hours: 5 })
      .expect(400);
  });

  it('answers 404 when extending an expired inbox', async () => {
    const { cookie } = await newSession();
    const [inbox] = await createInboxes(cookie, 1);
    await prisma.inbox.update({
      where: { id: inbox!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .patch(`/api/inboxes/${inbox!.id}/extend`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it("keeps one session's inboxes invisible and untouchable to another", async () => {
    const owner = await newSession();
    const intruder = await newSession();
    const [inbox] = await createInboxes(owner.cookie, 1);

    expect(await listInboxes(intruder.cookie)).toHaveLength(0);
    for (const attempt of [
      request(app.getHttpServer()).delete(`/api/inboxes/${inbox!.id}`),
      request(app.getHttpServer()).patch(`/api/inboxes/${inbox!.id}/extend`),
    ]) {
      const response = await attempt.set('Cookie', intruder.cookie).expect(404);
      expect((response.body as { code: string }).code).toBe('NOT_FOUND');
    }

    const [stillThere] = await listInboxes(owner.cookie);
    expect(stillThere).toEqual(inbox);
  });

  it('answers 404, not 400, for an id that is not a UUID', async () => {
    const { cookie } = await newSession();

    await request(app.getHttpServer())
      .delete('/api/inboxes/not-a-uuid')
      .set('Cookie', cookie)
      .expect(404);
  });

  it('limits a session to 20 inbox creations per hour, then answers 429 with Retry-After', async () => {
    const { cookie } = await newSession();
    for (let batch = 0; batch < 4; batch++) {
      const inboxes = await createInboxes(cookie, 5);
      for (const inbox of inboxes) {
        await request(app.getHttpServer())
          .delete(`/api/inboxes/${inbox.id}`)
          .set('Cookie', cookie)
          .expect(204);
      }
    }

    const response = await post(cookie).expect(429);

    expect((response.body as { code: string }).code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(3500);
    expect(await listInboxes(cookie)).toHaveLength(0);
  });
});
