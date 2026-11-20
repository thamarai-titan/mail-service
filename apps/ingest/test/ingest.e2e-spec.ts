import { randomBytes, randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import {
  addressKey,
  emailProcessingJobId,
  QUEUE_NAMES,
  type EmailProcessingJob,
} from '@repo/queue';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma.service.js';
import { RedisService } from '../src/core/redis.service.js';
import { StorageService } from '../src/core/storage.service.js';
import { LmtpServer } from '../src/lmtp/lmtp.server.js';
import { PolicyServer } from '../src/policy/policy.server.js';

const MAX_MESSAGE_BYTES = 8 * 1024;

/** A line-based client for LMTP and the policy protocol. */
class LineClient {
  private buffer = '';
  private waiting: (() => void) | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.waiting?.();
    });
  }

  static open(port: number): Promise<LineClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () =>
        resolve(new LineClient(socket)),
      );
      socket.once('error', reject);
    });
  }

  write(text: string): void {
    this.socket.write(text);
  }

  /** Waits until the buffer holds `count` complete SMTP replies and returns their final lines. */
  async replies(count = 1): Promise<string[]> {
    const finalLines = () =>
      this.buffer
        .split('\r\n')
        .slice(0, -1)
        .filter((line) => /^\d{3} /.test(line));
    await this.until(() => finalLines().length >= count);
    const lines = finalLines().slice(0, count);
    // Drop everything up to and including the last consumed reply.
    const last = lines.at(-1)!;
    this.buffer = this.buffer.slice(
      this.buffer.indexOf(`${last}\r\n`) + last.length + 2,
    );
    return lines;
  }

  /** Waits for one policy reply (`action=...` plus an empty line). */
  async policyReply(): Promise<string> {
    await this.until(() => this.buffer.includes('\n\n'));
    const end = this.buffer.indexOf('\n\n');
    const reply = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + 2);
    return reply;
  }

  async command(line: string, count = 1): Promise<string[]> {
    this.write(`${line}\r\n`);
    return this.replies(count);
  }

  close(): void {
    this.socket.destroy();
  }

  private until(ready: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out; buffer: ${this.buffer}`)),
        3000,
      );
      const check = () => {
        if (!ready()) return;
        clearTimeout(timer);
        this.waiting = null;
        resolve();
      };
      this.waiting = check;
      check();
    });
  }
}

// Needs the dev infrastructure running and seeded: `pnpm infra:up && pnpm db:seed`.
describe('Ingest (e2e)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let redis: RedisService;
  let storage: StorageService;
  let queue: Queue<EmailProcessingJob>;
  let lmtpPort: number;
  let policyPort: number;
  const sessionIds: string[] = [];
  const addresses: string[] = [];
  const clients: LineClient[] = [];

  /** A live inbox registered in Redis the way the API does it. */
  async function newInbox(options: { register?: boolean } = {}) {
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
    const address = `${localPart}@${domain.name}`;
    addresses.push(address);
    const expiresAt = new Date(Date.now() + 3600_000);
    const inbox = await prisma.inbox.create({
      data: {
        sessionId: session.id,
        domainId: domain.id,
        localPart,
        address,
        expiresAt,
      },
    });
    if (options.register !== false) {
      await redis.hset(addressKey(address), {
        inboxId: inbox.id,
        sessionId: session.id,
        expiresAt: String(expiresAt.getTime()),
      });
    }
    return inbox;
  }

  async function expire(inbox: { id: string; address: string }) {
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await redis.del(addressKey(inbox.address));
  }

  async function lmtp(): Promise<LineClient> {
    const client = await LineClient.open(lmtpPort);
    clients.push(client);
    expect((await client.replies())[0]).toMatch(/^220 .* LMTP/);
    await client.command('LHLO test.example');
    return client;
  }

  const message = (subject: string, body = 'Hello there.') =>
    [
      'From: sender@example.com',
      `Subject: ${subject}`,
      `Message-ID: <${randomUUID()}@example.com>`,
      '',
      body,
    ].join('\r\n');

  /** Sends DATA and returns one reply per recipient. */
  async function sendData(
    client: LineClient,
    raw: string,
    recipients: number,
  ): Promise<string[]> {
    expect((await client.command('DATA'))[0]).toMatch(/^354 /);
    client.write(`${raw.replace(/^\./gm, '..')}\r\n.\r\n`);
    return client.replies(recipients);
  }

  async function jobFor(inboxId: string): Promise<EmailProcessingJob[]> {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    return jobs
      .filter((job) => job.data.inboxId === inboxId)
      .map((j) => j.data);
  }

  beforeAll(async () => {
    process.env['INGEST_LMTP_PORT'] = '0';
    process.env['INGEST_POLICY_PORT'] = '0';
    process.env['MAX_MESSAGE_BYTES'] = String(MAX_MESSAGE_BYTES);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await moduleRef.createNestApplication().init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    storage = app.get(StorageService);
    lmtpPort = app.get(LmtpServer).port;
    policyPort = app.get(PolicyServer).port;
    queue = new Queue(QUEUE_NAMES.emailProcessing, { connection: redis });
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  afterAll(async () => {
    const inboxIds = (
      await prisma.inbox.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true },
      })
    ).map((inbox) => inbox.id);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    for (const job of jobs.filter((j) => inboxIds.includes(j.data.inboxId))) {
      await storage.delete(job.data.rawObjectKey);
      await job.remove();
    }
    await queue.close();
    // Rows first, so a failure in the Redis cleanup cannot leave live inboxes behind.
    await prisma.anonymousSession.deleteMany({
      where: { id: { in: sessionIds } },
    });
    if (addresses.length > 0) {
      await redis.del(...addresses.map((address) => addressKey(address)));
    }
    await app.close();
  });

  it('accepts mail for a live address, stores the raw message and queues a job', async () => {
    const inbox = await newInbox();
    const client = await lmtp();
    await client.command('MAIL FROM:<sender@example.com>');
    expect(
      await client.command(`RCPT TO:<${inbox.address.toUpperCase()}>`),
    ).toEqual([expect.stringMatching(/^250 /)]);
    const raw = message('Welcome', '.leading dot survives');

    expect(await sendData(client, raw, 1)).toEqual(['250 2.0.0 Queued']);

    const [job] = await jobFor(inbox.id);
    expect(job).toMatchObject({
      inboxId: inbox.id,
      sessionId: inbox.sessionId,
      rawObjectKey: expect.stringMatching(/^raw\/[0-9a-f-]+\.eml$/),
      dedupeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const stored = (await storage.get(job!.rawObjectKey))!.toString();
    expect(stored).toContain('Subject: Welcome');
    expect(stored).toContain('\r\n.leading dot survives');
    expect(
      (await queue.getJob(emailProcessingJobId(job!)))?.opts.attempts,
    ).toBe(5);
  });

  it('rejects unknown and expired addresses at RCPT TO', async () => {
    const expired = await newInbox();
    await expire(expired);
    const client = await lmtp();
    await client.command('MAIL FROM:<sender@example.com>');

    expect(await client.command('RCPT TO:<nobody@mail.localhost>')).toEqual([
      expect.stringMatching(/^550 5\.1\.1 User unknown/),
    ]);
    expect(await client.command(`RCPT TO:<${expired.address}>`)).toEqual([
      expect.stringMatching(/^550 5\.1\.1 Mailbox expired/),
    ]);
  });

  it('answers each recipient separately when one inbox expires before DATA', async () => {
    const live = await newInbox();
    const lapsing = await newInbox();
    const client = await lmtp();
    await client.command('MAIL FROM:<sender@example.com>');
    await client.command(`RCPT TO:<${live.address}>`);
    await client.command(`RCPT TO:<${lapsing.address}>`);
    await expire(lapsing);

    expect(await sendData(client, message('Two recipients'), 2)).toEqual([
      '250 2.0.0 Queued',
      expect.stringMatching(/^550 5\.1\.1 Mailbox unavailable/),
    ]);
    expect(await jobFor(live.id)).toHaveLength(1);
    expect(await jobFor(lapsing.id)).toHaveLength(0);
  });

  it('accepts a live inbox missing from Redis and puts it back', async () => {
    const inbox = await newInbox({ register: false });
    const client = await lmtp();
    await client.command('MAIL FROM:<sender@example.com>');

    expect(await client.command(`RCPT TO:<${inbox.address}>`)).toEqual([
      expect.stringMatching(/^250 /),
    ]);
    expect(await redis.hget(addressKey(inbox.address), 'inboxId')).toBe(
      inbox.id,
    );
  });

  it('refuses a message over the size limit', async () => {
    const inbox = await newInbox();
    const client = await lmtp();
    await client.command('MAIL FROM:<sender@example.com>');
    await client.command(`RCPT TO:<${inbox.address}>`);

    const replies = await sendData(
      client,
      message('Big', 'x'.repeat(MAX_MESSAGE_BYTES * 2)),
      1,
    );

    expect(replies[0]).toMatch(/^552 /);
    expect(await jobFor(inbox.id)).toHaveLength(0);
  });

  it('answers Postfix policy requests on one connection, in order', async () => {
    const live = await newInbox();
    const expired = await newInbox();
    await expire(expired);
    const client = await LineClient.open(policyPort);
    clients.push(client);
    const ask = (recipient: string) =>
      `request=smtpd_access_policy\nprotocol_state=RCPT\nsender=a@example.com\nrecipient=${recipient}\n\n`;

    client.write(
      ask(live.address) + ask('nobody@mail.localhost') + ask(expired.address),
    );
    client.write('request=smtpd_access_policy\nprotocol_state=CONNECT\n\n');

    expect(await client.policyReply()).toBe('action=DUNNO');
    expect(await client.policyReply()).toBe('action=550 5.1.1 User unknown');
    expect(await client.policyReply()).toBe('action=550 5.1.1 Mailbox expired');
    expect(await client.policyReply()).toBe('action=DUNNO');
  });
});
