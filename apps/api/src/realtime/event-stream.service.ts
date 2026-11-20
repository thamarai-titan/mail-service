import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EVENT_TYPES, type SessionEvent } from '@repo/events';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventHub } from './event-hub.js';
import { tooManyStreams } from './realtime.errors.js';

/** Keeps proxies and browsers from timing out an idle stream (README section 9). */
export const HEARTBEAT_MS = 25_000;
/** How long the browser waits before reconnecting. */
const RETRY_MS = 3000;
/**
 * Streams are closed after this long. The browser reconnects at once, which sends the request
 * through SessionGuard again, so an expired session does not keep receiving events.
 */
const MAX_STREAM_MS = 30 * 60_000;
export const MAX_STREAMS_PER_SESSION = 5;
const REPLAY_LIMIT = 100;
const MAX_EVENT_ID = 9223372036854775807n;

/** One event in text/event-stream framing. Events without an id leave Last-Event-ID alone. */
export function formatEvent(event: SessionEvent): string {
  const id = event.eventId === null ? '' : `id: ${event.eventId}\n`;
  return `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Server-sent event streams: one per open dashboard tab. */
@Injectable()
export class EventStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(EventStreamService.name);
  private readonly open = new Set<Response>();

  constructor(
    private readonly hub: EventHub,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Starts streaming the session's events to `res`. With a `Last-Event-ID`, the NEW_EMAIL
   * events missed since then are sent first. Live events that arrive during that replay are
   * held back and sent after it, so nothing is lost or sent twice.
   */
  async stream(
    sessionId: string,
    lastEventId: string | undefined,
    res: Response,
  ): Promise<void> {
    if (this.hub.listenerCount(sessionId) >= MAX_STREAMS_PER_SESSION) {
      throw tooManyStreams();
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform keeps compression middleware (including Next's dev proxy) from buffering.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx: pass each event through as it is written.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RETRY_MS}\n\n`);
    this.open.add(res);

    let held: SessionEvent[] | null = [];
    const unsubscribe = this.hub.subscribe(sessionId, (event) => {
      if (held) held.push(event);
      else res.write(formatEvent(event));
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const maxAge = setTimeout(() => res.end(), MAX_STREAM_MS);
    res.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(maxAge);
      unsubscribe();
      this.open.delete(res);
    });

    const replayed = new Set<string>();
    try {
      for (const event of await this.missedEvents(sessionId, lastEventId)) {
        replayed.add(event.eventId!);
        res.write(formatEvent(event));
      }
    } catch (error) {
      // The dashboard refetches its lists on reconnect anyway; replay only adds detail.
      this.logger.warn(`Event replay failed: ${(error as Error).message}`);
    }
    const pending = held;
    held = null;
    for (const event of pending) {
      if (event.eventId === null || !replayed.has(event.eventId)) {
        res.write(formatEvent(event));
      }
    }
  }

  /** Ends every open stream so shutdown is not held up by idle connections. */
  onModuleDestroy(): void {
    for (const res of this.open) res.end();
    this.open.clear();
  }

  /** NEW_EMAIL events after `lastEventId` for messages still in the session's live inboxes. */
  private async missedEvents(
    sessionId: string,
    lastEventId: string | undefined,
  ): Promise<SessionEvent[]> {
    if (!lastEventId || !/^\d{1,19}$/.test(lastEventId)) return [];
    const after = BigInt(lastEventId);
    if (after >= MAX_EVENT_ID) return [];

    const rows = await this.prisma.emailEvent.findMany({
      where: {
        id: { gt: after },
        eventType: 'RECEIVED',
        messageId: { not: null },
        inbox: { sessionId, status: 'active', expiresAt: { gt: new Date() } },
      },
      orderBy: { id: 'asc' },
      take: REPLAY_LIMIT,
      select: { id: true, inboxId: true, messageId: true },
    });
    return rows.map((row) => ({
      type: EVENT_TYPES.newEmail,
      eventId: row.id.toString(),
      inboxId: row.inboxId,
      messageId: row.messageId!,
    }));
  }
}
