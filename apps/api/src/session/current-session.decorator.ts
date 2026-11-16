import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithSession, SessionContext } from './session.types.js';

/** The session attached by SessionGuard. Only valid on routes that use the guard. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionContext => {
    const { session } = context.switchToHttp().getRequest<RequestWithSession>();
    if (!session) {
      throw new Error('@CurrentSession() used on a route without SessionGuard');
    }
    return session;
  },
);
