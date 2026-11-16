import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Hasher } from '../security/hasher.js';
import type { SessionContext } from './session.types.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 5 * 60;
/** A session's expiry slides at most this often, so most requests never write to PostgreSQL. */
const TOUCH_INTERVAL_SECONDS = 5 * 60;
/** A real token is 43 characters; anything far longer is not worth hashing. */
const MAX_TOKEN_LENGTH = 128;

const cacheKey = (tokenHash: string) => `sess:${tokenHash}`;
const touchKey = (sessionId: string) => `sess:touch:${sessionId}`;

export interface ValidatedSession {
  session: SessionContext;
  /** True when this request slid the expiry, so the cookie should be re-issued. */
  renewed: boolean;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly hasher: Hasher,
  ) {}

  /** Creates a session and returns the raw token, which exists only in this return value. */
  async create(
    clientIp: string | undefined,
  ): Promise<{ token: string; session: SessionContext }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hasher.hmac(token);
    const session = await this.prisma.anonymousSession.create({
      data: {
        tokenHash,
        ipHash: clientIp ? this.hasher.hmac(clientIp) : null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
      select: { id: true, expiresAt: true },
    });
    await this.writeCache(tokenHash, session);
    await this.claimTouch(session.id);
    return { token, session };
  }

  /** Resolves a cookie token to its session, or null when unknown, expired or revoked. */
  async validate(token: string): Promise<ValidatedSession | null> {
    if (token.length > MAX_TOKEN_LENGTH) return null;
    const tokenHash = this.hasher.hmac(token);

    let session = await this.readCache(tokenHash);
    if (!session) {
      const row = await this.prisma.anonymousSession.findUnique({
        where: { tokenHash },
        select: { id: true, status: true, expiresAt: true },
      });
      if (!row || row.status !== 'active') return null;
      session = { id: row.id, expiresAt: row.expiresAt };
      if (session.expiresAt.getTime() > Date.now()) {
        await this.writeCache(tokenHash, session);
      }
    }
    if (session.expiresAt.getTime() <= Date.now()) return null;

    if (!(await this.claimTouch(session.id))) {
      return { session, renewed: false };
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const { count } = await this.prisma.anonymousSession.updateMany({
      where: { id: session.id, status: 'active' },
      data: { lastSeenAt: now, expiresAt },
    });
    if (count === 0) {
      // Revoked or deleted since it was cached.
      await this.dropCache(tokenHash);
      return null;
    }
    session = { id: session.id, expiresAt };
    await this.writeCache(tokenHash, session);
    return { session, renewed: true };
  }

  // Redis is a cache here: when it is unreachable every lookup falls through to PostgreSQL.

  private async readCache(tokenHash: string): Promise<SessionContext | null> {
    try {
      const cached = await this.redis.get(cacheKey(tokenHash));
      if (!cached) return null;
      const { id, expiresAt } = JSON.parse(cached) as {
        id: string;
        expiresAt: string;
      };
      return { id, expiresAt: new Date(expiresAt) };
    } catch (error) {
      this.warn('read', error);
      return null;
    }
  }

  private async writeCache(
    tokenHash: string,
    session: SessionContext,
  ): Promise<void> {
    const remainingSeconds = Math.ceil(
      (session.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (remainingSeconds <= 0) return;
    try {
      await this.redis.set(
        cacheKey(tokenHash),
        JSON.stringify(session),
        'EX',
        Math.min(CACHE_TTL_SECONDS, remainingSeconds),
      );
    } catch (error) {
      this.warn('write', error);
    }
  }

  private async dropCache(tokenHash: string): Promise<void> {
    try {
      await this.redis.del(cacheKey(tokenHash));
    } catch (error) {
      this.warn('delete', error);
    }
  }

  /** True for the first caller in each touch interval. Without Redis the expiry simply does not slide. */
  private async claimTouch(sessionId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.set(
        touchKey(sessionId),
        '1',
        'EX',
        TOUCH_INTERVAL_SECONDS,
        'NX',
      );
      return claimed === 'OK';
    } catch (error) {
      this.warn('touch', error);
      return false;
    }
  }

  private warn(operation: string, error: unknown): void {
    this.logger.warn(
      `Session cache ${operation} failed: ${(error as Error).message}`,
    );
  }
}
