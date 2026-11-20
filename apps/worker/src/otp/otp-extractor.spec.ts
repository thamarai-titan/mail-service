import { extractOtp } from './otp-extractor.js';

const otp = (text: string, subject = '') => extractOtp({ subject, text });

describe('extractOtp', () => {
  it.each([
    ['Your verification code is 482913. It expires in 10 minutes.', '482913'],
    ['Use 7731 to sign in.', '7731'],
    ['Your one-time passcode: 123-456', '123456'],
    ['Enter this code: 123 456', '123456'],
    ['Security code\n\n  90210331\n', '90210331'],
    ['Your login code is K7Q2XP', 'K7Q2XP'],
    ['582044 is your Instagram code.', '582044'],
  ])('finds the code in %j', (text, expected) => {
    expect(otp(text)).toBe(expected);
  });

  it('finds a code given only in the subject', () => {
    expect(otp('Thanks for signing up.', 'Your code: 551234')).toBe('551234');
  });

  it.each([
    'Your order #48213 has shipped.',
    'Order number 48213 confirmation',
    'Total: $1234 due 2026-11-20 at 10:30',
    'We met in 2024 and talked about it.',
    'Call 555-1234 or visit https://example.com/123456',
    'Write to user123456@example.com',
    'Plain text only, no subject. Just checking this address works.',
    'Your verification link is below. Confirm your EMAIL.',
    'Version 3.14159 is out',
  ])('finds nothing in %j', (text) => {
    expect(otp(text)).toBeNull();
  });

  it('ignores numbers far from any keyword', () => {
    const text = `Your code is below.${' filler'.repeat(30)} Meeting room 4821.`;
    expect(otp(text)).toBeNull();
  });
});
