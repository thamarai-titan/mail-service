import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** a-z and 2-9 without the look-alikes l, o, 0 and 1: 32 symbols, 5 bits each. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const LOCAL_PART_LENGTH = 12;

@Injectable()
export class AddressGenerator {
  /** A random local part with about 60 bits of entropy, so addresses cannot be guessed. */
  localPart(): string {
    let value = '';
    for (let i = 0; i < LOCAL_PART_LENGTH; i++) {
      value += ALPHABET[randomInt(ALPHABET.length)];
    }
    return value;
  }
}
