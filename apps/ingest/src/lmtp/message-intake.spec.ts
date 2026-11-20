import type { EmailQueue } from '../core/email-queue.service.js';
import type { StorageService } from '../core/storage.service.js';
import type {
  Recipient,
  RecipientResolver,
} from '../recipients/recipient-resolver.js';
import { MessageIntake } from './message-intake.js';

const RAW = Buffer.from(
  'From: a@example.com\r\nSubject: Hi\r\nMessage-ID: <1@example.com>\r\n\r\nBody\r\n',
);
const LIVE: Recipient = {
  status: 'live',
  inboxId: 'inbox-1',
  sessionId: 'session-1',
};

function setup(
  overrides: {
    resolve?: (address: string) => Promise<Recipient>;
    put?: () => Promise<void>;
    add?: () => Promise<void>;
  } = {},
) {
  const deleted: string[] = [];
  const stored: string[] = [];
  const recipients = {
    resolve: overrides.resolve ?? (() => Promise.resolve(LIVE)),
  } as unknown as RecipientResolver;
  const storage = {
    put: async (key: string) => {
      await (overrides.put ?? (() => Promise.resolve()))();
      stored.push(key);
    },
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve();
    },
  } as unknown as StorageService;
  const queue = {
    add: overrides.add ?? (() => Promise.resolve()),
  } as unknown as EmailQueue;
  return {
    intake: new MessageIntake(recipients, storage, queue),
    stored,
    deleted,
  };
}

describe('MessageIntake', () => {
  it('accepts each live recipient', async () => {
    const { intake, stored } = setup();
    expect(await intake.deliver(RAW, ['a@x', 'b@x'])).toEqual([
      { accepted: true },
      { accepted: true },
    ]);
    // One raw copy per recipient.
    expect(new Set(stored).size).toBe(2);
  });

  it('refuses a recipient whose inbox is gone with a permanent error', async () => {
    const { intake } = setup({
      resolve: (address) =>
        Promise.resolve(address === 'gone@x' ? { status: 'expired' } : LIVE),
    });
    expect(await intake.deliver(RAW, ['a@x', 'gone@x'])).toEqual([
      { accepted: true },
      { accepted: false, code: 550, message: '5.1.1 Mailbox unavailable' },
    ]);
  });

  it('defers when the recipient lookup fails', async () => {
    const { intake } = setup({
      resolve: () => Promise.reject(new Error('down')),
    });
    expect(await intake.deliver(RAW, ['a@x'])).toEqual([
      {
        accepted: false,
        code: 451,
        message: '4.3.0 Temporary recipient lookup failure',
      },
    ]);
  });

  it('defers when the raw message cannot be stored', async () => {
    const { intake } = setup({
      put: () => Promise.reject(new Error('s3 down')),
    });
    expect(await intake.deliver(RAW, ['a@x'])).toEqual([
      {
        accepted: false,
        code: 451,
        message: '4.3.0 Temporary storage failure',
      },
    ]);
  });

  it('defers and removes the stored copy when the job cannot be queued', async () => {
    const { intake, stored, deleted } = setup({
      add: () => Promise.reject(new Error('redis down')),
    });
    expect(await intake.deliver(RAW, ['a@x'])).toEqual([
      { accepted: false, code: 451, message: '4.3.0 Temporary queue failure' },
    ]);
    expect(deleted).toEqual(stored);
  });
});
