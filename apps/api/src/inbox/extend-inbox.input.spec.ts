import { parseExtendInboxBody } from './extend-inbox.input.js';

describe('parseExtendInboxBody', () => {
  it('treats no body or no hours as the default one-hour extension', () => {
    expect(parseExtendInboxBody(undefined)).toEqual({});
    expect(parseExtendInboxBody({})).toEqual({});
  });

  it('accepts the offered durations', () => {
    for (const hours of [1, 6, 12, 24]) {
      expect(parseExtendInboxBody({ hours })).toEqual({ hours });
    }
  });

  it('rejects anything else', () => {
    for (const hours of [0, 2, 25, 1.5, '6', -1]) {
      expect(() => parseExtendInboxBody({ hours })).toThrow();
    }
    expect(() => parseExtendInboxBody([])).toThrow();
  });
});
