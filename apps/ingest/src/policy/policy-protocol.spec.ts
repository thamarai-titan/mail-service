import {
  MAX_REQUEST_BYTES,
  PolicyRequestParser,
  PolicyRequestTooLarge,
  policyResponse,
  recipientAction,
} from './policy-protocol.js';

describe('PolicyRequestParser', () => {
  it('parses one request per empty line, across chunk boundaries', () => {
    const parser = new PolicyRequestParser();
    expect(
      parser.feed('request=smtpd_access_policy\nprotocol_state=RC'),
    ).toEqual([]);
    expect(
      parser.feed(
        'PT\nrecipient=a@b.example\n\nrequest=smtpd_access_policy\r\nrecipient=c@d.example\r\n\r\n',
      ),
    ).toEqual([
      {
        request: 'smtpd_access_policy',
        protocol_state: 'RCPT',
        recipient: 'a@b.example',
      },
      { request: 'smtpd_access_policy', recipient: 'c@d.example' },
    ]);
  });

  it('keeps everything after the first = and ignores lines without one', () => {
    const parser = new PolicyRequestParser();
    expect(
      parser.feed('sasl_method=\nnoise\nccert_subject=CN=x=y\n\n'),
    ).toEqual([{ sasl_method: '', ccert_subject: 'CN=x=y' }]);
  });

  it('refuses an endless line', () => {
    const parser = new PolicyRequestParser();
    expect(() => parser.feed('x'.repeat(MAX_REQUEST_BYTES + 1))).toThrow(
      PolicyRequestTooLarge,
    );
  });
});

describe('recipientAction', () => {
  it('lets live addresses through and rejects the rest at RCPT TO', () => {
    expect(
      recipientAction({ status: 'live', inboxId: 'i', sessionId: 's' }),
    ).toBe('DUNNO');
    expect(recipientAction({ status: 'expired' })).toBe(
      '550 5.1.1 Mailbox expired',
    );
    expect(recipientAction({ status: 'unknown' })).toBe(
      '550 5.1.1 User unknown',
    );
  });

  it('formats the reply', () => {
    expect(policyResponse('DUNNO')).toBe('action=DUNNO\n\n');
  });
});
