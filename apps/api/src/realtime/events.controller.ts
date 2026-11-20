import { Controller, Get, Headers, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentSession } from '../session/current-session.decorator.js';
import { SessionGuard } from '../session/session.guard.js';
import type { SessionContext } from '../session/session.types.js';
import { EventStreamService } from './event-stream.service.js';

@Controller('events')
@UseGuards(SessionGuard)
export class EventsController {
  constructor(private readonly streams: EventStreamService) {}

  /** Server-sent events for the session: NEW_EMAIL, INBOX_DELETED and INBOX_EXPIRED. */
  @Get()
  stream(
    @CurrentSession() session: SessionContext,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    return this.streams.stream(session.id, lastEventId, res);
  }
}
