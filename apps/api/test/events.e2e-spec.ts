import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { sessionChannel } from '@repo/events';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { MAX_STREAMS_PER_SESSION } from './../src/realtime/event-stream.service.js';
import { RedisService } from './../src/redis/redis.service.js';

interface Inbox {
  id: string;
  address: string;
}

/** An open SSE connection that collects everything the server writes. */
interface Stream {
  status: number;
  headers: Headers;
  /** Resolves with all text received so far once it contains `text`. */
  waitFor(text: string, timeoutMs?: number): Promise<string>;
  received(): string;
  close(): void;
}

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('Events (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let prisma: PrismaService;
  let redis: RedisService;
  const createdSessionIds: string[] = [];
  const streams: Stream[] = [];

  async function resetRateLimits(): Promise<void> {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function newSession() {
    await resetRateLimits();
    const created = await request(app.getHttpServer())
      .post('/api/sessions')
      .expect(201);
    const sessionId = (created.body as { sessionId: string }).sessionId;
    createdSessionIds.push(sessionId);
    const cookie = (
      created.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    const response = await request(app.getHttpServer())
      .post('/api/inboxes')
      .set('Cookie', cookie)
      .send({ count: 1 })
      .expect(201);
    const inbox = (response.body as { inboxes: Inbox[] }).inboxes[0]!;
    return { sessionId, cookie, inbox };
  }

  async function openStream(
    cookie: string | null,
    lastEventId?: string,
  ): Promise<Stream> {
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (cookie) headers['cookie'] = cookie;
    if (lastEventId) headers['last-event-id'] = lastEventId;
    const response = await fetch(`${baseUrl}/api/events`, {
      headers,
      signal: controller.signal,
    });
    let text = '';
    const waiters = new Set<() => void>();
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            for (const wake of waiters) wake();
          }
        } catch {
          // Aborted by close().
        }
      })();
    }
    const stream: Stream = {
      status: response.status,
      headers: response.headers,
      received: () => text,
      waitFor: (expected, timeoutMs = 3000) =>
        new Promise((resolve, reject) => {
          const check = () => {
            if (!text.includes(expected)) return;
            waiters.delete(check);
            clearTimeout(timer);
            resolve(text);
          };
          const timer = setTimeout(() => {
            waiters.delete(check);
            reject(new Error(`Timed out waiting for ${expected}; got ${text}`));
          }, timeoutMs);
          waiters.add(check);
          check();
        }),
      close: () => controller.abort(),
    };
    streams.push(stream);
    return stream;
  }

  /** A stored message with its RECEIVED event, standing in for the worker. Returns the event id. */
  async function deliver(
    inbox: Inbox,
  ): Promise<{ eventId: string; messageId: string }> {
    const messageId = randomUUID();
    await prisma.message.create({
      data: {
        id: messageId,
        inboxId: inbox.id,
        dedupeHash: messageId,
        fromAddress: 'sender@example.com',
        sizeBytes: 1n,
        rawObjectKey: `raw/${messageId}.eml`,
      },
    });
    const event = await prisma.emailEvent.create({
      data: { messageId, inboxId: inbox.id, eventType: 'RECEIVED' },
    });
    return { eventId: event.id.toString(), messageId };
  }

  const publish = (sessionId: string, event: object) =>
    redis.publish(sessionChannel(sessionId), JSON.stringify(event));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    // The hub subscribes in the background at start-up; wait until it has.
    await vi.waitFor(async () =>
      expect(Number(await redis.call('PUBSUB', 'NUMPAT'))).toBeGreaterThan(0),
    );
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
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
    const stream = await openStream(null);
    expect(stream.status).toBe(401);
  });

  it('opens an unbuffered event stream and delivers only this session’s events', async () => {
    const me = await newSession();
    const other = await newSession();
    const stream = await openStream(me.cookie);

    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(stream.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    await stream.waitFor('retry: 3000\n\n');

    await publish(other.sessionId, {
      type: 'NEW_EMAIL',
      eventId: '1',
      inboxId: other.inbox.id,
      messageId: 'not-mine',
    });
    await publish(me.sessionId, {
      type: 'NEW_EMAIL',
      eventId: '42',
      inboxId: me.inbox.id,
      messageId: 'mine',
    });

    const text = await stream.waitFor('"messageId":"mine"');
    expect(text).toContain(
      `id: 42\nevent: NEW_EMAIL\ndata: {"type":"NEW_EMAIL","eventId":"42","inboxId":"${me.inbox.id}","messageId":"mine"}\n\n`,
    );
    expect(text).not.toContain('not-mine');
  });

  it('replays NEW_EMAIL events missed since Last-Event-ID', async () => {
    const me = await newSession();
    const first = await deliver(me.inbox);
    const second = await deliver(me.inbox);
    const third = await deliver(me.inbox);

    const stream = await openStream(me.cookie, first.eventId);
    const text = await stream.waitFor(third.messageId);

    expect(text).not.toContain(first.messageId);
    expect(text.indexOf(`id: ${second.eventId}\n`)).toBeGreaterThan(0);
    expect(text.indexOf(`id: ${third.eventId}\n`)).toBeGreaterThan(
      text.indexOf(`id: ${second.eventId}\n`),
    );
  });

  it('ignores a malformed Last-Event-ID', async () => {
    const me = await newSession();
    await deliver(me.inbox);
    const stream = await openStream(me.cookie, '1; DROP TABLE');
    await stream.waitFor('retry: 3000');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stream.received()).not.toContain('NEW_EMAIL');
  });

  it('announces a deleted inbox to the session’s other tabs', async () => {
    const me = await newSession();
    const stream = await openStream(me.cookie);
    await stream.waitFor('retry: 3000');

    await request(app.getHttpServer())
      .delete(`/api/inboxes/${me.inbox.id}`)
      .set('Cookie', me.cookie)
      .expect(204);

    const text = await stream.waitFor('INBOX_DELETED');
    expect(text).toContain(
      `event: INBOX_DELETED\ndata: {"type":"INBOX_DELETED","eventId":null,"inboxId":"${me.inbox.id}"}\n\n`,
    );
    // No id line, so the browser's Last-Event-ID still points at the last stored event.
    expect(text).not.toMatch(/id: .*\nevent: INBOX_DELETED/);
  });

  it(`refuses more than ${MAX_STREAMS_PER_SESSION} open streams per session`, async () => {
    const me = await newSession();
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i++) {
      const stream = await openStream(me.cookie);
      await stream.waitFor('retry: 3000');
    }

    const extra = await openStream(me.cookie);
    expect(extra.status).toBe(429);

    streams[0]!.close();
    await vi.waitFor(async () => {
      const again = await openStream(me.cookie);
      expect(again.status).toBe(200);
    });
  });
});
