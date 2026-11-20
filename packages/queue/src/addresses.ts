/**
 * The Redis index of live addresses (`addr:ADDRESS`, a hash). The API writes it when inboxes
 * are created, extended or deleted; ingest reads it to accept or reject recipients.
 * Each key expires together with its inbox.
 */
export const addressKey = (address: string): string =>
  `addr:${address.toLowerCase()}`;

export interface AddressEntry {
  inboxId: string;
  sessionId: string;
  expiresAt: Date;
}

/** The hash fields for HSET. */
export function serializeAddressEntry(
  entry: AddressEntry,
): Record<string, string> {
  return {
    inboxId: entry.inboxId,
    sessionId: entry.sessionId,
    expiresAt: String(entry.expiresAt.getTime()),
  };
}

/** The entry from an HGETALL result, or null when the key is missing or incomplete. */
export function parseAddressEntry(
  hash: Record<string, string>,
): AddressEntry | null {
  const { inboxId, sessionId, expiresAt } = hash;
  const expiresAtMs = Number(expiresAt);
  if (!inboxId || !sessionId || !Number.isFinite(expiresAtMs)) return null;
  return { inboxId, sessionId, expiresAt: new Date(expiresAtMs) };
}
