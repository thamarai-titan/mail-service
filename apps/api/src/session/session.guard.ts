import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.js';
import {
  SESSION_COOKIE,
  readCookie,
  setSessionCookie,
} from './session-cookie.js';
import { noSession, sessionInvalid } from './session.errors.js';
import { SessionService } from './session.service.js';
import type { RequestWithSession } from './session.types.js';

/** Authenticates the `sid` cookie and attaches the session to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithSession>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) throw noSession();

    const validated = await this.sessions.validate(token);
    if (!validated) throw sessionInvalid();

    request.session = validated.session;
    if (validated.renewed) {
      // Keep the cookie's lifetime in step with the slid server-side expiry.
      setSessionCookie(
        http.getResponse<Response>(),
        token,
        validated.session.expiresAt,
        this.config.secureCookies,
      );
    }
    return true;
  }
}
