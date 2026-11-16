import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentSession } from '../session/current-session.decorator.js';
import { SessionGuard } from '../session/session.guard.js';
import type { SessionContext } from '../session/session.types.js';
import { parseListMessagesQuery } from './list-messages.query.js';
import { messageNotFound } from './message.errors.js';
import {
  MessageService,
  type MessageDetail,
  type MessagePage,
} from './message.service.js';

/** A malformed id cannot belong to the session, so it gets the same 404 as any other miss. */
const MessageId = () =>
  Param('id', new ParseUUIDPipe({ exceptionFactory: messageNotFound }));

@Controller('messages')
@UseGuards(SessionGuard)
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  /** `?view=unified` (the default) or `?inboxId=`, with optional `cursor` and `limit`. */
  @Get()
  list(
    @CurrentSession() session: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<MessagePage> {
    return this.messages.list(session.id, parseListMessagesQuery(query));
  }

  @Get(':id')
  open(
    @CurrentSession() session: SessionContext,
    @MessageId() id: string,
  ): Promise<MessageDetail> {
    return this.messages.open(session.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentSession() session: SessionContext,
    @MessageId() id: string,
  ): Promise<void> {
    await this.messages.delete(session.id, id);
  }
}
