import { ApiError } from '../common/api-error.js';
import { parseCreateInboxesBody } from './create-inboxes.input.js';

describe('parseCreateInboxesBody', () => {
  it('defaults to one inbox when the body or count is missing', () => {
    expect(parseCreateInboxesBody(undefined)).toEqual({ count: 1 });
    expect(parseCreateInboxesBody({})).toEqual({ count: 1 });
  });

  it('accepts counts 1 to 5 and an optional domain id', () => {
    const domainId = '4bc33506-02cf-4ebd-87e4-dfaba939bdf7';
    expect(parseCreateInboxesBody({ count: 5 })).toEqual({ count: 5 });
    expect(parseCreateInboxesBody({ count: 2, domainId })).toEqual({
      count: 2,
      domainId,
    });
  });

  it.each([0, 6, -1, 1.5, '3', null, Number.NaN])(
    'rejects count %p',
    (count) => {
      expect(() => parseCreateInboxesBody({ count })).toThrow(ApiError);
    },
  );

  it('rejects a domain id that is not a UUID and a body that is not an object', () => {
    expect(() => parseCreateInboxesBody({ domainId: 'x' })).toThrow(ApiError);
    expect(() => parseCreateInboxesBody([1])).toThrow(ApiError);
    expect(() => parseCreateInboxesBody('5')).toThrow(ApiError);
  });
});
