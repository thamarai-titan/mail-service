import type { Recipient } from '../recipients/recipient-resolver.js';

/**
 * Postfix policy delegation protocol (https://www.postfix.org/SMTPD_POLICY_README.html):
 * the client sends `name=value` lines ending with an empty line; the server answers
 * `action=...` followed by an empty line. One connection carries many requests.
 */

/** Larger requests are refused: Postfix sends well under 4 KB. */
export const MAX_REQUEST_BYTES = 64 * 1024;

export type PolicyRequest = Record<string, string>;

export class PolicyRequestTooLarge extends Error {}

/** Splits a byte stream into complete requests. Feed it each chunk as it arrives. */
export class PolicyRequestParser {
  private buffer = '';
  private current: PolicyRequest = {};

  feed(chunk: string): PolicyRequest[] {
    this.buffer += chunk;
    const complete: PolicyRequest[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '') {
        if (Object.keys(this.current).length > 0) complete.push(this.current);
        this.current = {};
        continue;
      }
      const equals = line.indexOf('=');
      if (equals > 0) {
        this.current[line.slice(0, equals)] = line.slice(equals + 1);
      }
    }
    if (this.buffer.length > MAX_REQUEST_BYTES) {
      throw new PolicyRequestTooLarge();
    }
    return complete;
  }
}

export const policyResponse = (action: string): string =>
  `action=${action}\n\n`;

/** DUNNO lets Postfix's other restrictions decide; anything else rejects at RCPT TO. */
export function recipientAction(recipient: Recipient): string {
  switch (recipient.status) {
    case 'live':
      return 'DUNNO';
    case 'expired':
      return '550 5.1.1 Mailbox expired';
    case 'unknown':
      return '550 5.1.1 User unknown';
  }
}

/** Postfix keeps the mail and the sender retries. */
export const LOOKUP_FAILED_ACTION =
  '451 4.3.0 Temporary recipient lookup failure';
