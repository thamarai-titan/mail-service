import { AddressGenerator } from './address-generator.js';

describe('AddressGenerator', () => {
  const generator = new AddressGenerator();

  it('produces 12 characters from a-z and 2-9 without the look-alikes l, o, 0 and 1', () => {
    for (let i = 0; i < 500; i++) {
      expect(generator.localPart()).toMatch(/^[a-km-np-z2-9]{12}$/);
    }
  });

  it('does not repeat across many draws', () => {
    const drawn = new Set(
      Array.from({ length: 5000 }, () => generator.localPart()),
    );
    expect(drawn.size).toBe(5000);
  });
});
