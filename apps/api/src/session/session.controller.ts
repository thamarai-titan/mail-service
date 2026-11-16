import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfig } from '../config/app-config.js';
import { CurrentSession } from './current-session.decorator.js';
import { SessionCreationLimitGuard } from './session-creation-limit.guard.js';
import { setSessionCookie } from './session-cookie.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import type { SessionContext } from './session.types.js';

export interface SessionResponse {
  sessionId: string;
  expiresAt: string;
}

const toResponse = (session: SessionContext): SessionResponse => ({
  sessionId: session.id,
  expiresAt: session.expiresAt.toISOString(),
});

@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
  ) {}

  /** Creates an anonymous session. The token is returned only as an HttpOnly cookie. */
  @Post()
  @UseGuards(SessionCreationLimitGuard)
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const { token, session } = await this.sessions.create(request.ip);
    setSessionCookie(
      response,
      token,
      session.expiresAt,
      this.config.secureCookies,
    );
    return toResponse(session);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentSession() session: SessionContext): SessionResponse {
    return toResponse(session);
  }
}
