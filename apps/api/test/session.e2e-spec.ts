import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { RedisService } from './../src/redis/redis.service.js';
import { Hasher } from './../src/security/hasher.js';

// Needs the dev infrastructure running: `pnpm infra:up`.
describe('Sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let hasher: Hasher;
  const createdSessionIds: string[] = [];

  /** Clears the per-IP creation counter so tests do not exhaust each other's budget. */
  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys('rl:sess-create:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function createSession() {
    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .expect(201);
    const body = response.body as { sessionId: string; expiresAt: string };
    createdSessionIds.push(body.sessionId);
    const setCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0]!;
    const token = /^sid=([^;]+)/.exec(setCookie)![1]!;
    return { body, setCookie, token };
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
    hasher = app.get(Hasher);
  });

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await prisma.anonymousSession.deleteMany({
      where: { id: { in: createdSessionIds } },
    });
    await resetRateLimits();
    await app.close();
  });

  it('creates a session and hands the token over only in an HttpOnly, SameSite=Strict cookie', async () => {
    const { body, setCookie, token } = await createSession();

    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const hoursUntilExpiry =
      (new Date(body.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hoursUntilExpiry).toBeGreaterThan(23.9);
    expect(hoursUntilExpiry).toBeLessThanOrEqual(24);

    expect(token).toHaveLength(43); // 32 random bytes, base64url
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api');
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('stores only the HMAC of the token, never the token itself', async () => {
    const { body, token } = await createSession();

    const row = await prisma.anonymousSession.findUniqueOrThrow({
      where: { id: body.sessionId },
    });

    expect(row.tokenHash).toBe(hasher.hmac(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('authenticates later requests from the cookie', async () => {
    const { body, token } = await createSession();

    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(200);

    expect(response.body).toEqual(body);
  });

  it('still authenticates from PostgreSQL when the Redis cache entry is gone', async () => {
    const { body, token } = await createSession();
    await redis.del(`sess:${hasher.hmac(token)}`);

    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(200);

    expect((response.body as { sessionId: string }).sessionId).toBe(
      body.sessionId,
    );
  });

  it('answers 401 NO_SESSION without a cookie', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .expect(401);

    expect((response.body as { code: string }).code).toBe('NO_SESSION');
  });

  it('answers 401 SESSION_INVALID for a token it never issued', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', 'sid=not-a-real-token')
      .expect(401);

    expect((response.body as { code: string }).code).toBe('SESSION_INVALID');
  });

  it('rejects an expired session', async () => {
    const { body, token } = await createSession();
    await prisma.anonymousSession.update({
      where: { id: body.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await redis.del(`sess:${hasher.hmac(token)}`);

    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(401);

    expect((response.body as { code: string }).code).toBe('SESSION_INVALID');
  });

  it('rejects a revoked session', async () => {
    const { body, token } = await createSession();
    await prisma.anonymousSession.update({
      where: { id: body.sessionId },
      data: { status: 'revoked' },
    });
    await redis.del(`sess:${hasher.hmac(token)}`);

    await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(401);
  });

  it('slides the expiry and re-issues the cookie once the touch interval has passed', async () => {
    const { body, token } = await createSession();
    const staleExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.anonymousSession.update({
      where: { id: body.sessionId },
      data: { expiresAt: staleExpiry },
    });
    // Simulate five minutes passing: the cache entry and the touch claim have both expired.
    await redis.del(
      `sess:${hasher.hmac(token)}`,
      `sess:touch:${body.sessionId}`,
    );

    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(200);

    const row = await prisma.anonymousSession.findUniqueOrThrow({
      where: { id: body.sessionId },
    });
    expect(row.expiresAt.getTime()).toBeGreaterThan(staleExpiry.getTime());
    expect((response.body as { expiresAt: string }).expiresAt).toBe(
      row.expiresAt.toISOString(),
    );
    expect(response.headers['set-cookie']?.[0]).toContain(`sid=${token}`);
  });

  it('does not write to PostgreSQL again within the touch interval', async () => {
    const { body, token } = await createSession();
    const before = await prisma.anonymousSession.findUniqueOrThrow({
      where: { id: body.sessionId },
    });

    const response = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Cookie', `sid=${token}`)
      .expect(200);

    const after = await prisma.anonymousSession.findUniqueOrThrow({
      where: { id: body.sessionId },
    });
    expect(after.lastSeenAt).toEqual(before.lastSeenAt);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('limits one IP to 5 new sessions per hour, then answers 429 with Retry-After', async () => {
    for (let i = 0; i < 5; i++) await createSession();

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .expect(429);

    expect((response.body as { code: string }).code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(3500);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
