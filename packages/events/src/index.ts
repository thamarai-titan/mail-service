/** Events pushed to the browser over SSE (README section 9). */
export const EVENT_TYPES = {
  newEmail: 'NEW_EMAIL',
  inboxExpired: 'INBOX_EXPIRED',
  inboxDeleted: 'INBOX_DELETED',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** Redis Pub/Sub channel carrying one session's events. */
export const sessionChannel = (sessionId: string): string =>
  `events:session:${sessionId}`;
