import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import { assertCanAward, awarderStanding } from '../policies';
import {
  cardLinkUrl,
  cardTokenHash,
  decryptCardToken,
  encryptCardToken,
  generateCardToken,
  newCardToken,
} from '../token';

const ID_A = '01900000-0000-7000-8000-00000000000a';
const ID_B = '01900000-0000-7000-8000-00000000000b';

describe('card tokens', () => {
  it('are 32 URL-safe characters, and never the same twice', () => {
    const tokens = Array.from({ length: 500 }, generateCardToken);
    expect(tokens.every((token) => /^[A-Za-z0-9_-]{32}$/.test(token))).toBe(true);
    expect(new Set(tokens).size).toBe(500);
  });

  it('are looked up by a hash that is the same every time and does not contain the token', () => {
    const token = generateCardToken();
    expect(cardTokenHash(token)).toBe(cardTokenHash(token));
    expect(cardTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(cardTokenHash(token)).not.toContain(token);
    expect(cardTokenHash(token)).not.toBe(cardTokenHash(generateCardToken()));
  });

  it('are kept as an encrypted copy that reads back for the membership it belongs to', () => {
    const token = generateCardToken();
    const cipher = encryptCardToken(token, ID_A);
    expect(Buffer.from(cipher).toString('utf8')).not.toContain(token);
    expect(decryptCardToken(cipher, ID_A)).toBe(token);
  });

  it('do not read back for another membership, or once damaged', () => {
    const token = generateCardToken();
    const cipher = encryptCardToken(token, ID_A);
    expect(decryptCardToken(cipher, ID_B)).toBeNull();
    const damaged = new Uint8Array(cipher);
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0xff;
    expect(decryptCardToken(damaged, ID_A)).toBeNull();
    expect(decryptCardToken(new Uint8Array(4), ID_A)).toBeNull();
  });

  it('make a fresh token with its three stored values at once', () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const made = newCardToken(ID_A, now);
    expect(made.hash).toBe(cardTokenHash(made.token));
    expect(decryptCardToken(made.cipher, ID_A)).toBe(made.token);
    expect(made.createdAt).toBe(now);
  });

  it('open a /c/ address under the app origin', () => {
    expect(cardLinkUrl('a'.repeat(32))).toMatch(/\/c\/a{32}$/);
  });

  it('do not share a key with committee view links: the same text hashes differently', () => {
    // The two kinds of link use their own labels, so one can never open the other's page.
    const token = generateCardToken();
    expect(cardTokenHash(token)).not.toBe(
      // What a committee would store for the same text (same secret, its own label).
      cardTokenHash(`committee-view:${token}`),
    );
  });
});

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: 'user-actor',
  isFullAdmin: false,
  memberships: [],
  ...overrides,
});

const officerOf = (clubId: string): Actor =>
  actor({
    memberships: [{ membershipId: 'm-officer', clubId, role: 'CLUB_OFFICER', committees: [] }],
  });
const leadOf = (clubId: string, committeeId: string): Actor =>
  actor({
    memberships: [
      {
        membershipId: 'm-lead',
        clubId,
        role: 'MEMBER',
        committees: [{ committeeMembershipId: 'cm', committeeId, role: 'LEAD' }],
      },
    ],
  });

const member = { userId: 'user-member', clubId: 'club-1', committeeIds: ['committee-1'] };

describe('the award rules', () => {
  it('see an officer of the club, a lead of one of the member’s committees, and a stranger', () => {
    expect(awarderStanding(officerOf('club-1'), member)).toMatchObject({
      officer: true,
      lead: false,
    });
    expect(awarderStanding(leadOf('club-1', 'committee-1'), member)).toMatchObject({
      officer: false,
      lead: true,
    });
    expect(awarderStanding(leadOf('club-1', 'committee-9'), member)).toMatchObject({ lead: false });
    expect(awarderStanding(officerOf('club-2'), member)).toMatchObject({ officer: false });
  });

  it('let an officer and a full admin award', () => {
    expect(() => assertCanAward(officerOf('club-1'), member, 'star')).not.toThrow();
    expect(() => assertCanAward(actor({ isFullAdmin: true }), member, 'founder')).not.toThrow();
  });

  it('let a lead award all but the founder sticker, with the reason', () => {
    const lead = leadOf('club-1', 'committee-1');
    expect(() => assertCanAward(lead, member, 'hack')).not.toThrow();
    expect(() => assertCanAward(lead, member, 'founder')).toThrow(AuthzError);
    try {
      assertCanAward(lead, member, 'founder');
    } catch (error) {
      expect((error as AuthzError).reason).toBe('sticker_award_not_allowed');
    }
  });

  it('refuse awarding oneself, unless the actor is a full admin', () => {
    const self = { ...member, userId: 'user-actor' };
    const officer = { ...officerOf('club-1'), userId: 'user-actor' };
    expect(() => assertCanAward(officer, self, 'star')).toThrow(AuthzError);
    try {
      assertCanAward(officer, self, 'star');
    } catch (error) {
      expect((error as AuthzError).reason).toBe('cannot_award_self');
    }
    expect(() => assertCanAward(actor({ isFullAdmin: true }), self, 'star')).not.toThrow();
  });

  it('refuse a sticker a rule gives, even to a full admin', () => {
    expect(() => assertCanAward(actor({ isFullAdmin: true }), member, 'lead')).toThrow(AuthzError);
  });
});
