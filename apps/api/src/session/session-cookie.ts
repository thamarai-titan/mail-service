import type { Response } from 'express';

export const SESSION_COOKIE = 'sid';

/** Reads one cookie from a raw `Cookie` header. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      const value = pair.slice(separator + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

/** Sets the session cookie. JavaScript can never read it, and it is only sent to the API. */
export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api',
    expires: expiresAt,
  });
}
