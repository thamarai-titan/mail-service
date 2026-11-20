import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentSession } from '../session/current-session.decorator.js';
import { SessionGuard } from '../session/session.guard.js';
import type { SessionContext } from '../session/session.types.js';
import { attachmentNotFound } from './attachment.errors.js';
import { AttachmentService } from './attachment.service.js';
import {
  attachmentDisposition,
  safeContentType,
} from './content-disposition.js';

@Controller('attachments')
@UseGuards(SessionGuard)
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  /**
   * Always a download, never displayed inline, and never sniffed into another type, so an
   * HTML or SVG attachment cannot run in the app's origin.
   */
  @Get(':id/download')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: attachmentNotFound }))
    id: string,
  ): Promise<StreamableFile> {
    const file = await this.attachments.download(session.id, id);
    return new StreamableFile(file.body, {
      type: safeContentType(file.contentType),
      disposition: attachmentDisposition(file.filename),
      length: file.length,
    });
  }
}
