import { validationError } from '../common/api-error.js';

/** Durations the dashboard offers: keep the inbox until this many hours from now. */
export const KEEP_FOR_HOURS = [1, 6, 12, 24] as const;

/**
 * Validates the PATCH /inboxes/:id/extend body. No body (or no `hours`) keeps the original
 * behaviour, one more hour on top of the current expiry; `hours` means "until N hours from now".
 */
export function parseExtendInboxBody(body: unknown): { hours?: number } {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('Request body must be a JSON object.');
  }
  const { hours } = body as Record<string, unknown>;
  if (hours === undefined || hours === null) return {};
  if (!KEEP_FOR_HOURS.includes(hours as (typeof KEEP_FOR_HOURS)[number])) {
    throw validationError(`hours must be one of ${KEEP_FOR_HOURS.join(', ')}.`);
  }
  return { hours: hours as number };
}
