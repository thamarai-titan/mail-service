import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentSession } from '../session/current-session.decorator.js';
import { SessionGuard } from '../session/session.guard.js';
import type { SessionContext } from '../session/session.types.js';
import { parseCreateInboxesBody } from './create-inboxes.input.js';
import { parseExtendInboxBody } from './extend-inbox.input.js';
import { inboxNotFound } from './inbox.errors.js';
import { InboxService, type InboxView } from './inbox.service.js';

/** A malformed id cannot belong to the session, so it gets the same 404 as any other miss. */
const InboxId = () =>
  Param('id', new ParseUUIDPipe({ exceptionFactory: inboxNotFound }));

@Controller('inboxes')
@UseGuards(SessionGuard)
export class InboxController {
  constructor(private readonly inboxes: InboxService) {}

  /** Creates 1 to 5 inboxes in one go. */
  @Post()
  async create(
    @CurrentSession() session: SessionContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<{ inboxes: InboxView[] }> {
    const { count, domainId } = parseCreateInboxesBody(body);
    try {
      await this.inboxes.assertCreationBudget(session.id, request.ip, count);
    } catch (error) {
      const retryAfter = (error as { retryAfterSeconds?: number })
        .retryAfterSeconds;
      if (retryAfter !== undefined) {
        response.setHeader('Retry-After', retryAfter);
      }
      throw error;
    }
    const inboxes = await this.inboxes.create({
      sessionId: session.id,
      clientIp: request.ip,
      count,
      domainId,
    });
    return { inboxes };
  }

  @Get()
  async list(
    @CurrentSession() session: SessionContext,
  ): Promise<{ inboxes: InboxView[] }> {
    return { inboxes: await this.inboxes.list(session.id) };
  }

  @Patch(':id/extend')
  extend(
    @CurrentSession() session: SessionContext,
    @InboxId() id: string,
    @Body() body: unknown,
  ): Promise<InboxView> {
    const { hours } = parseExtendInboxBody(body);
    return this.inboxes.extend(session.id, id, hours);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentSession() session: SessionContext,
    @InboxId() id: string,
  ): Promise<void> {
    await this.inboxes.delete(session.id, id);
  }
}
