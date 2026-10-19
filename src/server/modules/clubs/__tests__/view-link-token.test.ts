import { describe, expect, it, vi } from 'vitest';

import { viewTokenSchema } from '@/shared/contracts/clubs';

import {
  decryptViewToken,
  encryptViewToken,
  generateViewToken,
  toViewLink,
  viewTokenHash,
} from '../view-link-token';

const COMMITTEE = '0192d000-0000-7000-8000-000000000001';
const OTHER_COMMITTEE = '0192d000-0000-7000-8000-000000000002';

describe('generateViewToken', () => {
  it('produces the 32 URL-safe characters the contract describes', () => {
    for (let i = 0; i < 50; i++) {
      expect(viewTokenSchema.safeParse(generateViewToken()).success).toBe(true);
    }
  });

  it('never repeats a token (192 random bits, not derived from anything)', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateViewToken));
    expect(tokens.size).toBe(500);
  });
});

describe('viewTokenHash', () => {
  it('is stable for one token and different for another', () => {
    const token = generateViewToken();
    expect(viewTokenHash(token)).toBe(viewTokenHash(token));
    expect(viewTokenHash(token)).not.toBe(viewTokenHash(generateViewToken()));
  });

  it('is 64 lower-case hex characters, as the CHECK constraint requires', () => {
    expect(viewTokenHash(generateViewToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  // What stops the lookup from leaking how close a guess was: two tokens that share all but one
  // character hash to unrelated values, so the index compares nothing like the caller's input.
  it('shares no prefix between tokens that differ in one character', () => {
    const a = viewTokenHash('a'.repeat(32));
    const b = viewTokenHash(`${'a'.repeat(31)}b`);
    expect(a.slice(0, 4)).not.toBe(b.slice(0, 4));
  });

  it('does not contain the token', () => {
    const token = generateViewToken();
    expect(viewTokenHash(token)).not.toContain(token);
  });
});

describe('the stored copy of a token', () => {
  it('comes back as it went in', () => {
    const token = generateViewToken();
    expect(decryptViewToken(encryptViewToken(token, COMMITTEE), COMMITTEE)).toBe(token);
  });

  it('is different bytes every time, so two committees with one token look unrelated', () => {
    const token = generateViewToken();
    const first = encryptViewToken(token, COMMITTEE);
    const second = encryptViewToken(token, COMMITTEE);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it('holds nothing readable', () => {
    const token = generateViewToken();
    expect(Buffer.from(encryptViewToken(token, COMMITTEE)).toString('utf8')).not.toContain(token);
  });

  it('refuses to decrypt for another committee', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cipher = encryptViewToken(generateViewToken(), COMMITTEE);
    expect(decryptViewToken(cipher, OTHER_COMMITTEE)).toBeNull();
  });

  it('refuses to decrypt tampered bytes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cipher = encryptViewToken(generateViewToken(), COMMITTEE);
    const tampered = Buffer.from(cipher);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 0xff, tampered.length - 1);
    expect(decryptViewToken(tampered, COMMITTEE)).toBeNull();
  });

  it('answers null instead of throwing on nonsense', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decryptViewToken(Buffer.alloc(0), COMMITTEE)).toBeNull();
    expect(decryptViewToken(Buffer.from('not a token'), COMMITTEE)).toBeNull();
  });
});

describe('toViewLink', () => {
  it('builds the whole URL under APP_ORIGIN', () => {
    const link = toViewLink('A'.repeat(32), new Date('2026-10-17T12:00:00.000Z'));
    expect(link.url).toBe(`http://localhost:3000/v/${'A'.repeat(32)}`);
    expect(link.token).toBe('A'.repeat(32));
    expect(link.createdAt).toBe('2026-10-17T12:00:00.000Z');
  });
});
