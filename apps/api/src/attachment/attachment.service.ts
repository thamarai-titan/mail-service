import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { attachmentBlocked, attachmentNotFound } from './attachment.errors.js';

export interface AttachmentDownload {
  filename: string;
  contentType: string;
  body: Readable;
  length: number | undefined;
}

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The stored file, if it belongs to a live inbox of this session. */
  async download(
    sessionId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        message: {
          inbox: { sessionId, status: 'active', expiresAt: { gt: new Date() } },
        },
      },
      select: {
        filename: true,
        contentType: true,
        storageKey: true,
        isBlocked: true,
      },
    });
    if (!attachment) throw attachmentNotFound();
    if (attachment.isBlocked || !attachment.storageKey) {
      throw attachmentBlocked();
    }

    const object = await this.storage.getStream(attachment.storageKey);
    if (!object) throw attachmentNotFound();
    return {
      filename: attachment.filename,
      contentType: attachment.contentType,
      body: object.body,
      length: object.contentLength,
    };
  }
}
