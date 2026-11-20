import { Injectable } from '@nestjs/common';
import { EVENT_TYPES } from '@repo/events';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventPublisher } from '../realtime/event-publisher.js';
import { Hasher } from '../security/hasher.js';
import { RateLimiter } from '../security/rate-limiter.js';
import { sessionInvalid } from '../session/session.errors.js';
import { AddressGenerator } from './address-generator.js';
import { AddressRegistry } from './address-registry.js';
import {
  domainUnavailable,
  inboxCreationRateLimited,
  inboxNotFound,
  quotaExceeded,
} from './inbox.errors.js';

export const MAX_INBOXES_PER_REQUEST = 5;
export const INBOX_CREATIONS_PER_HOUR = 20;
const INBOX_TTL_MS = 60 * 60 * 1000;
/** An inbox can be extended until it has lived this long in total. */
const MAX_INBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** Extra rounds allowed when a generated address already exists. */
const MAX_COLLISION_RETRIES = 3;

export interface InboxView {
  id: string;
  address: string;
  createdAt: Date;
  expiresAt: Date;
  messageCount: number;
  unreadCount: number;
}

export interface CreateInboxesInput {
  sessionId: string;
  clientIp: string | undefined;
  count: number;
  domainId?: string;
}

export interface RateLimited {
  retryAfterSeconds: number;
}

const inboxSelect = {
  id: true,
  address: true,
  createdAt: true,
  expiresAt: true,
  messageCount: true,
} as const;

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiter,
    private readonly hasher: Hasher,
    private readonly generator: AddressGenerator,
    private readonly registry: AddressRegistry,
    private readonly events: EventPublisher,
  ) {}

  /** Throws the 429 error carrying `retryAfterSeconds` when the hourly creation budget is spent. */
  async assertCreationBudget(
    sessionId: string,
    clientIp: string | undefined,
    count: number,
  ): Promise<void> {
    const keys = [`inbox-create:s:${sessionId}`];
    if (clientIp) keys.push(`inbox-create:ip:${this.hasher.hmac(clientIp)}`);
    for (const key of keys) {
      const { allowed, retryAfterSeconds } = await this.rateLimiter.hit(
        key,
        INBOX_CREATIONS_PER_HOUR,
        60 * 60,
        count,
      );
      if (!allowed) {
        throw Object.assign(inboxCreationRateLimited(), { retryAfterSeconds });
      }
    }
  }

  /** Creates `count` inboxes atomically: either all of them exist afterwards or none do. */
  async create(input: CreateInboxesInput): Promise<InboxView[]> {
    const { sessionId, count } = input;
    const domain = await this.resolveDomain(input.domainId);

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the session row so concurrent requests cannot both pass the quota check.
      const locked = await tx.$queryRaw<{ inbox_quota: number }[]>`
        SELECT inbox_quota FROM anonymous_sessions
        WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const quota = locked[0]?.inbox_quota;
      if (quota === undefined) throw sessionInvalid();

      const now = new Date();
      const active = await tx.inbox.count({
        where: { sessionId, status: 'active', expiresAt: { gt: now } },
      });
      const remaining = Math.max(quota - active, 0);
      if (count > remaining) throw quotaExceeded(remaining);

      const expiresAt = new Date(now.getTime() + INBOX_TTL_MS);
      const rows: Omit<InboxView, 'unreadCount'>[] = [];
      for (
        let round = 0;
        round <= MAX_COLLISION_RETRIES && rows.length < count;
        round++
      ) {
        const candidates = Array.from({ length: count - rows.length }, () => {
          const localPart = this.generator.localPart();
          return {
            sessionId,
            domainId: domain.id,
            localPart,
            address: `${localPart}@${domain.name}`,
            expiresAt,
          };
        });
        // Addresses that already exist are skipped rather than failing the transaction.
        const inserted = await tx.inbox.createManyAndReturn({
          data: candidates,
          skipDuplicates: true,
          select: inboxSelect,
        });
        rows.push(...inserted);
      }
      if (rows.length < count) {
        throw new Error(
          `Could not generate ${count} unique addresses after ${MAX_COLLISION_RETRIES} retries`,
        );
      }
      return rows;
    });

    await this.registry.register(
      created.map((inbox) => ({
        address: inbox.address,
        inboxId: inbox.id,
        sessionId,
        expiresAt: inbox.expiresAt,
      })),
    );
    // Same order as list(): inboxes created together share a timestamp, so the id breaks the tie.
    return created
      .map((inbox) => ({ ...inbox, unreadCount: 0 }))
      .sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** The session's live inboxes, newest first. */
  async list(sessionId: string): Promise<InboxView[]> {
    const inboxes = await this.prisma.inbox.findMany({
      where: { sessionId, status: 'active', expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        ...inboxSelect,
        _count: { select: { messages: { where: { isRead: false } } } },
      },
    });
    return inboxes.map(({ _count, ...inbox }) => ({
      ...inbox,
      unreadCount: _count.messages,
    }));
  }

  /** Adds another hour, never beyond 24 hours after the inbox was created. */
  async extend(sessionId: string, inboxId: string): Promise<InboxView> {
    const inbox = await this.prisma.$transaction(async (tx) => {
      // Scoping every query by session id is what makes another session's inbox a 404.
      const current = await tx.inbox.findFirst({
        where: {
          id: inboxId,
          sessionId,
          status: 'active',
          expiresAt: { gt: new Date() },
        },
        select: { createdAt: true, expiresAt: true },
      });
      if (!current) throw inboxNotFound();

      const expiresAt = new Date(
        Math.min(
          current.expiresAt.getTime() + INBOX_TTL_MS,
          current.createdAt.getTime() + MAX_INBOX_LIFETIME_MS,
        ),
      );
      return tx.inbox.update({
        where: { id: inboxId },
        data: { expiresAt },
        select: {
          ...inboxSelect,
          _count: { select: { messages: { where: { isRead: false } } } },
        },
      });
    });

    await this.registry.register([
      {
        address: inbox.address,
        inboxId: inbox.id,
        sessionId,
        expiresAt: inbox.expiresAt,
      },
    ]);
    const { _count, ...view } = inbox;
    return { ...view, unreadCount: _count.messages };
  }

  /** Soft-deletes the inbox and stops mail delivery to its address. */
  async delete(sessionId: string, inboxId: string): Promise<void> {
    const deleted = await this.prisma.inbox.updateManyAndReturn({
      where: { id: inboxId, sessionId, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date() },
      select: { address: true },
    });
    const inbox = deleted[0];
    if (!inbox) throw inboxNotFound();
    await this.registry.remove(inbox.address);
    // Other open tabs of the session drop the inbox too.
    await this.events.publish(sessionId, {
      type: EVENT_TYPES.inboxDeleted,
      eventId: null,
      inboxId,
    });
  }

  private async resolveDomain(
    domainId: string | undefined,
  ): Promise<{ id: string; name: string }> {
    const domain = await this.prisma.domain.findFirst({
      where: { isActive: true, ...(domainId ? { id: domainId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!domain) throw domainUnavailable();
    return domain;
  }
}
