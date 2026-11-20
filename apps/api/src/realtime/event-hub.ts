import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { sessionChannel, type SessionEvent } from '@repo/events';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';

type Listener = (event: SessionEvent) => void;

const CHANNEL_PREFIX = sessionChannel('');

/**
 * Fans session events from Redis Pub/Sub out to the open streams in this process. One
 * subscription covers every session, so the Redis load does not grow with the number of tabs.
 */
@Injectable()
export class EventHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventHub.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | undefined;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    // A connection in subscriber mode cannot run other commands, so it gets its own.
    // ioredis subscribes again by itself after a reconnect.
    this.subscriber = new Redis(this.config.redisUrl);
    this.subscriber.on('error', (error: NodeJS.ErrnoException) =>
      this.logger.warn(
        `Redis subscriber: ${error.message || error.code || error.name}`,
      ),
    );
    this.subscriber.on('pmessage', (_pattern, channel: string, raw: string) =>
      this.dispatch(channel, raw),
    );
    // Not awaited: the API should start even while Redis is down, and the command waits in
    // the offline queue until the connection is up.
    this.subscriber
      .psubscribe(sessionChannel('*'))
      .catch((error: Error) =>
        this.logger.error(`Could not subscribe to events: ${error.message}`),
      );
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
  }

  /** Calls `listener` for every event of the session until the returned function is called. */
  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  /** Open streams of one session in this process. */
  listenerCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }

  private dispatch(channel: string, raw: string): void {
    const listeners = this.listeners.get(channel.slice(CHANNEL_PREFIX.length));
    if (!listeners) return;
    let event: SessionEvent;
    try {
      event = JSON.parse(raw) as SessionEvent;
    } catch {
      this.logger.warn(`Ignoring malformed event on ${channel}`);
      return;
    }
    for (const listener of listeners) listener(event);
  }
}
