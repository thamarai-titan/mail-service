import { Injectable } from '@nestjs/common';
import { Prisma } from '@repo/database';
import { inboxNotFound } from '../inbox/inbox.errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListMessagesQuery } from './list-messages.query.js';
import { encodeCursor } from './message-cursor.js';
import { messageNotFound } from './message.errors.js';

const PREVIEW_LENGTH = 140;

export interface MessageSummary {
  id: string;
  inboxId: string;
  /** The address the message was sent to, shown as a chip in the unified view. */
  inboxAddress: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  preview: string;
  otpCode: string | null;
  isRead: boolean;
  attachmentCount: number;
  receivedAt: Date;
}

export interface MessagePage {
  messages: MessageSummary[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface AttachmentView {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isBlocked: boolean;
}

export interface MessageDetail extends Omit<
  MessageSummary,
  'preview' | 'attachmentCount'
> {
  textBody: string | null;
  htmlSanitized: string | null;
  sizeBytes: number;
  attachments: AttachmentView[];
}

interface SummaryRow {
  id: string;
  inbox_id: string;
  address: string;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  preview: string | null;
  otp_code: string | null;
  is_read: boolean;
  attachment_count: number;
  received_at: Date;
  received_at_text: string;
}

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of messages, newest first, from one inbox or from all of the session's live inboxes. */
  async list(
    sessionId: string,
    query: ListMessagesQuery,
  ): Promise<MessagePage> {
    const { inboxId, cursor, limit } = query;
    if (inboxId) await this.assertInboxOwned(sessionId, inboxId);

    // Every message query goes through inboxes.session_id: that join is the isolation rule.
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT m.id, m.inbox_id, i.address, m.from_address, m.from_name, m.subject,
             left(m.text_body, 400) AS preview, m.otp_code, m.is_read, m.received_at,
             to_char(m.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS received_at_text,
             (SELECT count(*)::int FROM attachments a WHERE a.message_id = m.id)
               AS attachment_count
      FROM messages m
      JOIN inboxes i ON i.id = m.inbox_id
      WHERE i.session_id = ${sessionId}::uuid
        AND i.status = 'active'
        AND i.expires_at > now()
        ${inboxId ? Prisma.sql`AND m.inbox_id = ${inboxId}::uuid` : Prisma.empty}
        ${
          cursor
            ? Prisma.sql`AND (m.received_at, m.id) < (${cursor.receivedAt}::timestamptz, ${cursor.id}::uuid)`
            : Prisma.empty
        }
      ORDER BY m.received_at DESC, m.id DESC
      LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      messages: page.map((row) => ({
        id: row.id,
        inboxId: row.inbox_id,
        inboxAddress: row.address,
        fromAddress: row.from_address,
        fromName: row.from_name,
        subject: row.subject,
        preview: (row.preview ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, PREVIEW_LENGTH),
        otpCode: row.otp_code,
        isRead: row.is_read,
        attachmentCount: row.attachment_count,
        receivedAt: row.received_at,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ receivedAt: last.received_at_text, id: last.id })
          : null,
    };
  }

  /** The full message. Opening it marks it read. */
  async open(sessionId: string, messageId: string): Promise<MessageDetail> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, inbox: this.liveInboxOf(sessionId) },
      select: {
        id: true,
        inboxId: true,
        inbox: { select: { address: true } },
        fromAddress: true,
        fromName: true,
        subject: true,
        textBody: true,
        htmlSanitized: true,
        otpCode: true,
        isRead: true,
        sizeBytes: true,
        receivedAt: true,
        attachments: {
          orderBy: { filename: 'asc' },
          select: {
            id: true,
            filename: true,
            contentType: true,
            sizeBytes: true,
            isBlocked: true,
          },
        },
      },
    });
    if (!message) throw messageNotFound();

    if (!message.isRead) {
      await this.prisma.message.updateMany({
        where: { id: messageId, isRead: false },
        data: { isRead: true },
      });
    }
    const { inbox, attachments, sizeBytes, ...rest } = message;
    return {
      ...rest,
      inboxAddress: inbox.address,
      isRead: true,
      sizeBytes: Number(sizeBytes),
      attachments: attachments.map((attachment) => ({
        ...attachment,
        sizeBytes: Number(attachment.sizeBytes),
      })),
    };
  }

  async delete(sessionId: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, inbox: this.liveInboxOf(sessionId) },
        select: { inboxId: true },
      });
      if (!message) throw messageNotFound();
      // deleteMany so a concurrent delete of the same message is a 404, not a crash.
      const { count } = await tx.message.deleteMany({
        where: { id: messageId },
      });
      if (count === 0) throw messageNotFound();
      await tx.$executeRaw`
        UPDATE inboxes SET message_count = GREATEST(message_count - 1, 0)
        WHERE id = ${message.inboxId}::uuid`;
    });
  }

  private liveInboxOf(sessionId: string): Prisma.InboxWhereInput {
    return { sessionId, status: 'active', expiresAt: { gt: new Date() } };
  }

  private async assertInboxOwned(
    sessionId: string,
    inboxId: string,
  ): Promise<void> {
    const inbox = await this.prisma.inbox.findFirst({
      where: { id: inboxId, ...this.liveInboxOf(sessionId) },
      select: { id: true },
    });
    if (!inbox) throw inboxNotFound();
  }
}
