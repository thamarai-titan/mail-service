import { ApiError } from '../common/api-error.js';
import { parseListMessagesQuery } from './list-messages.query.js';
import { decodeCursor, encodeCursor } from './message-cursor.js';

const INBOX_ID = '4bc33506-02cf-4ebd-87e4-dfaba939bdf7';
const CURSOR = { receivedAt: '2026-11-16T10:00:00.123456Z', id: INBOX_ID };

describe('message cursor', () => {
  it('round-trips, keeping microseconds', () => {
    expect(decodeCursor(encodeCursor(CURSOR))).toEqual(CURSOR);
  });

  it.each([
    'garbage',
    '',
    Buffer.from('2026-11-16T10:00:00.123Z|' + INBOX_ID).toString('base64url'),
    Buffer.from(`${CURSOR.receivedAt}|not-a-uuid`).toString('base64url'),
    Buffer.from(`${CURSOR.receivedAt}|${INBOX_ID}|extra`).toString('base64url'),
  ])('rejects the malformed cursor %p', (value) => {
    expect(() => decodeCursor(value)).toThrow(ApiError);
  });
});

describe('parseListMessagesQuery', () => {
  it('defaults to the unified view with 50 per page', () => {
    expect(parseListMessagesQuery({})).toEqual({ limit: 50 });
    expect(parseListMessagesQuery({ view: 'unified' })).toEqual({ limit: 50 });
  });

  it('accepts an inbox id, a cursor and a smaller limit', () => {
    expect(
      parseListMessagesQuery({
        inboxId: INBOX_ID,
        cursor: encodeCursor(CURSOR),
        limit: '10',
      }),
    ).toEqual({ inboxId: INBOX_ID, cursor: CURSOR, limit: 10 });
  });

  it.each([
    { view: 'all' },
    { view: 'unified', inboxId: INBOX_ID },
    { inboxId: 'nope' },
    { limit: '0' },
    { limit: '51' },
    { limit: 'ten' },
    { limit: '2.5' },
    { cursor: 'garbage' },
  ])('rejects %j', (query) => {
    expect(() => parseListMessagesQuery(query)).toThrow(ApiError);
  });
});
