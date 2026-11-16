import { invalidRequest } from './inbox.errors.js';
import { MAX_INBOXES_PER_REQUEST } from './inbox.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the POST /inboxes body. An empty body means one inbox on the default domain. */
export function parseCreateInboxesBody(body: unknown): {
  count: number;
  domainId?: string;
} {
  if (body === undefined || body === null) return { count: 1 };
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('Request body must be a JSON object.');
  }
  const { count = 1, domainId } = body as Record<string, unknown>;

  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_INBOXES_PER_REQUEST
  ) {
    throw invalidRequest(
      `count must be an integer from 1 to ${MAX_INBOXES_PER_REQUEST}.`,
    );
  }
  if (domainId === undefined || domainId === null) return { count };
  if (typeof domainId !== 'string' || !UUID.test(domainId)) {
    throw invalidRequest('domainId must be a UUID.');
  }
  return { count, domainId };
}
