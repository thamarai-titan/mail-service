import { UUID_PATTERN, validationError } from '../common/api-error.js';

/**
 * Position of the last message on a page. `receivedAt` is kept as PostgreSQL's own text with
 * microseconds: a JavaScript Date would round it to milliseconds and skip or repeat rows.
 */
export interface MessageCursor {
  receivedAt: string;
  id: string;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(`${cursor.receivedAt}|${cursor.id}`).toString('base64url');
}

export function decodeCursor(value: string): MessageCursor {
  const [receivedAt, id, ...rest] = Buffer.from(value, 'base64url')
    .toString('utf8')
    .split('|');
  if (
    rest.length > 0 ||
    !receivedAt ||
    !id ||
    !TIMESTAMP.test(receivedAt) ||
    !UUID_PATTERN.test(id)
  ) {
    throw validationError('cursor is not valid.');
  }
  return { receivedAt, id };
}
