import { UUID_PATTERN, validationError } from '../common/api-error.js';
import { decodeCursor, type MessageCursor } from './message-cursor.js';

export const DEFAULT_PAGE_SIZE = 50;

export interface ListMessagesQuery {
  /** Undefined means the unified view across all of the session's inboxes. */
  inboxId?: string;
  cursor?: MessageCursor;
  limit: number;
}

const single = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Validates the GET /messages query string. */
export function parseListMessagesQuery(
  query: Record<string, unknown>,
): ListMessagesQuery {
  const view = single(query['view']);
  const inboxId = single(query['inboxId']);
  const cursor = single(query['cursor']);
  const limitText = single(query['limit']);

  if (view !== undefined && view !== 'unified') {
    throw validationError('view must be "unified".');
  }
  if (view !== undefined && inboxId !== undefined) {
    throw validationError('Use either view=unified or inboxId, not both.');
  }
  if (inboxId !== undefined && !UUID_PATTERN.test(inboxId)) {
    throw validationError('inboxId must be a UUID.');
  }

  let limit = DEFAULT_PAGE_SIZE;
  if (limitText !== undefined) {
    limit = Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_SIZE) {
      throw validationError(
        `limit must be an integer from 1 to ${DEFAULT_PAGE_SIZE}.`,
      );
    }
  }
  return {
    inboxId,
    cursor: cursor === undefined ? undefined : decodeCursor(cursor),
    limit,
  };
}
