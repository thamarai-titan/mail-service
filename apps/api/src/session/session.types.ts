import type { Request } from 'express';

/** The authenticated anonymous session. Always derived from the cookie, never from client input. */
export interface SessionContext {
  id: string;
  expiresAt: Date;
}

export interface RequestWithSession extends Request {
  session?: SessionContext;
}
