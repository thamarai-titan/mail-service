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

/** A message published on {@link sessionChannel}, serialized as JSON. */
export interface SessionEvent {
  type: EventType;
  /**
   * `email_events.id` as a string, used as the SSE event id for Last-Event-ID replay.
   * Null for events that have no row in email_events.
   */
  eventId: string | null;
  inboxId: string;
  /** Set for NEW_EMAIL. */
  messageId?: string;
}
