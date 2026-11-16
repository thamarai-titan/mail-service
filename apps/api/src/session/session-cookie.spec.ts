import { readCookie } from './session-cookie.js';

describe('readCookie', () => {
  it('finds the named cookie among several', () => {
    expect(readCookie('theme=dark; sid=abc123; lang=en', 'sid')).toBe('abc123');
  });

  it('keeps "=" characters inside the value', () => {
    expect(readCookie('sid=a=b==', 'sid')).toBe('a=b==');
  });

  it('does not match a cookie whose name merely ends with the requested name', () => {
    expect(readCookie('xsid=evil', 'sid')).toBeUndefined();
  });

  it('returns undefined for a missing header, a missing cookie or an empty value', () => {
    expect(readCookie(undefined, 'sid')).toBeUndefined();
    expect(readCookie('theme=dark', 'sid')).toBeUndefined();
    expect(readCookie('sid=', 'sid')).toBeUndefined();
  });
});
