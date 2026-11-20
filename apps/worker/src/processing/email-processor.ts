import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@repo/database';
import { EVENT_TYPES, sessionChannel, type SessionEvent } from '@repo/events';
import type { EmailProcessingJob } from '@repo/queue';
import { objectKeys } from '@repo/storage';
import { UnrecoverableError } from 'bullmq';
import { simpleParser, type Attachment, type ParsedMail } from 'mailparser';
import { applyAttachmentPolicy } from '../attachment/attachment-policy.js';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';
import { StorageService } from '../core/storage.service.js';
import { extractOtp } from '../otp/otp-extractor.js';
import { htmlToPlainText, sanitizeEmailHtml } from './html-sanitizer.js';

/** Column limits so one hostile header cannot bloat a row. */
const MAX_SUBJECT_LENGTH = 998;
const MAX_ADDRESS_LENGTH = 320;
const MAX_NAME_LENGTH = 200;

export type ProcessingOutcome =
  | { status: 'stored'; messageId: string }
  | { status: 'duplicate' }
  | { status: 'inbox-gone' };

/** The inbox expired or was deleted between ingestion and the database write. */
class InboxGoneError extends Error {}

interface StoredAttachment {
  filename: string;
  contentType: string;
  sizeBytes: bigint;
  storageKey: string | null;
  sha256: string | null;
  isBlocked: boolean;
}

/** Steps W1 to W7 of README section 4: one queued message becomes a stored, announced message. */
@Injectable()
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  async process(job: EmailProcessingJob): Promise<ProcessingOutcome> {
    const { inboxId, sessionId, rawObjectKey, dedupeHash } = job;

    if (await this.isDuplicate(inboxId, dedupeHash)) {
      await this.recordDuplicate(job);
      return { status: 'duplicate' };
    }
    if (!(await this.inboxIsLive(inboxId, sessionId))) {
      return this.discard(job, []);
    }

    const raw = await this.storage.get(rawObjectKey);
    if (!raw) {
      throw new UnrecoverableError(`Raw message ${rawObjectKey} is missing`);
    }
    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(raw);
    } catch (error) {
      throw new UnrecoverableError(
        `Raw message ${rawObjectKey} cannot be parsed: ${(error as Error).message}`,
      );
    }

    const html = parsed.html ? sanitizeEmailHtml(parsed.html) : null;
    const text = parsed.text?.trim() || (html ? htmlToPlainText(html) : null);
    const subject = parsed.subject?.slice(0, MAX_SUBJECT_LENGTH) ?? null;
    const sender = parsed.from?.value[0];
    const otpCode = extractOtp({ subject, text });
    const attachments = await this.storeAttachments(job, parsed.attachments);

    let messageId: string;
    let receivedEventId: bigint;
    try {
      ({ messageId, receivedEventId } = await this.prisma.$transaction(
        async (tx) => {
          // Counting the message and checking the inbox in one statement closes the race with
          // expiry and deletion: the row lock holds until commit.
          const { count } = await tx.inbox.updateMany({
            where: {
              id: inboxId,
              sessionId,
              status: 'active',
              expiresAt: { gt: new Date() },
            },
            data: { messageCount: { increment: 1 } },
          });
          if (count === 0) throw new InboxGoneError();

          const message = await tx.message.create({
            data: {
              inboxId,
              dedupeHash,
              messageIdHeader: parsed.messageId?.slice(0, 998) ?? null,
              fromAddress: (sender?.address ?? '').slice(0, MAX_ADDRESS_LENGTH),
              fromName: sender?.name?.slice(0, MAX_NAME_LENGTH) || null,
              subject,
              textBody: text,
              htmlSanitized: html,
              otpCode,
              sizeBytes: BigInt(raw.length),
              rawObjectKey,
              receivedAt: new Date(job.receivedAt),
              attachments: { create: attachments },
            },
            select: { id: true },
          });
          const received = await tx.emailEvent.create({
            data: {
              messageId: message.id,
              inboxId,
              eventType: 'RECEIVED',
            },
            select: { id: true },
          });
          if (otpCode) {
            await tx.emailEvent.create({
              data: {
                messageId: message.id,
                inboxId,
                eventType: 'OTP_EXTRACTED',
              },
            });
          }
          return { messageId: message.id, receivedEventId: received.id };
        },
      ));
    } catch (error) {
      if (error instanceof InboxGoneError)
        return this.discard(job, attachments);
      if (isUniqueViolation(error)) {
        // A copy of the same message committed while this one was being processed.
        await this.recordDuplicate(job);
        return { status: 'duplicate' };
      }
      throw error;
    }

    await this.announce(sessionId, {
      type: EVENT_TYPES.newEmail,
      eventId: receivedEventId.toString(),
      inboxId,
      messageId,
    });
    return { status: 'stored', messageId };
  }

  private async isDuplicate(
    inboxId: string,
    dedupeHash: string,
  ): Promise<boolean> {
    const existing = await this.prisma.message.findUnique({
      where: { inboxId_dedupeHash: { inboxId, dedupeHash } },
      select: { id: true },
    });
    return existing !== null;
  }

  private async inboxIsLive(
    inboxId: string,
    sessionId: string,
  ): Promise<boolean> {
    const inbox = await this.prisma.inbox.findFirst({
      where: {
        id: inboxId,
        sessionId,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    return inbox !== null;
  }

  /**
   * Uploads allowed attachments and returns rows for all of them. Inline images the HTML
   * refers to are skipped: the parser already embedded them in the HTML as data: URIs.
   */
  private async storeAttachments(
    job: EmailProcessingJob,
    parts: Attachment[],
  ): Promise<StoredAttachment[]> {
    const files = parts.filter(
      (part) => !(part.related && part.contentType.startsWith('image/')),
    );
    const decisions = applyAttachmentPolicy(files);

    return Promise.all(
      decisions.map(async (decision, index) => {
        const part = files[index]!;
        const row = {
          filename: decision.filename,
          contentType: decision.contentType,
          sizeBytes: BigInt(part.size),
        };
        if (decision.blocked) {
          return { ...row, storageKey: null, sha256: null, isBlocked: true };
        }
        const key = objectKeys.attachment(job.inboxId, job.dedupeHash, index);
        await this.storage.put(key, part.content, decision.contentType);
        return {
          ...row,
          storageKey: key,
          sha256: createHash('sha256').update(part.content).digest('hex'),
          isBlocked: false,
        };
      }),
    );
  }

  /** The inbox is gone, so nobody can read this message: drop what was stored for it. */
  private async discard(
    job: EmailProcessingJob,
    attachments: StoredAttachment[],
  ): Promise<ProcessingOutcome> {
    this.logger.log(
      `EXPIRED_ON_ARRIVAL inbox ${job.inboxId}: discarding ${job.rawObjectKey}`,
    );
    const keys = [
      job.rawObjectKey,
      ...attachments.flatMap((a) => (a.storageKey ? [a.storageKey] : [])),
    ];
    await Promise.all(keys.map((key) => this.storage.delete(key)));
    return { status: 'inbox-gone' };
  }

  private async recordDuplicate(job: EmailProcessingJob): Promise<void> {
    this.logger.log(`DUPLICATE in inbox ${job.inboxId}: ${job.dedupeHash}`);
    try {
      await this.prisma.emailEvent.create({
        data: {
          inboxId: job.inboxId,
          eventType: 'DUPLICATE',
          payload: {
            dedupeHash: job.dedupeHash,
            rawObjectKey: job.rawObjectKey,
          },
        },
      });
    } catch (error) {
      // The inbox may have been deleted since; the event is only diagnostic.
      this.logger.warn(
        `Could not record DUPLICATE: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Tells the session's open dashboards. The message is already committed, so a failed publish
   * is logged, not retried: the browser catches up from email_events on reconnect.
   */
  private async announce(
    sessionId: string,
    event: SessionEvent,
  ): Promise<void> {
    try {
      await this.redis.publish(
        sessionChannel(sessionId),
        JSON.stringify(event),
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish ${event.type} for message ${event.messageId}: ${(error as Error).message}`,
      );
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
