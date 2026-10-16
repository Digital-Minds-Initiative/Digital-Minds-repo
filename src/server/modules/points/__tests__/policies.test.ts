import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import { assertCanWritePoints } from '../policies';

/*
 * Tested as a pure function, because no request can reach its refusal: to address a transaction
 * at all you must see both the member and the committee, and the only actors who see both are
 * the ones this allows — an officer of the club, a lead of that committee, or a full admin.
 * Anyone else gets a 404 first. It stays as the guard that still refuses if a scope is ever
 * widened (docs/adr/0019-points-rules.md), the same reasoning as ADR 0017's type-change rule.
 */

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const A1 = 'committee-a1';
const A2 = 'committee-a2';

const admin: Actor = { userId: 'admin', isFullAdmin: true, memberships: [] };
const officerA: Actor = {
  userId: 'officer-a',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm1', clubId: CLUB_A, role: 'CLUB_OFFICER', committees: [] }],
};
const leadA1: Actor = {
  userId: 'lead-a1',
  isFullAdmin: false,
  memberships: [
    {
      membershipId: 'm2',
      clubId: CLUB_A,
      role: 'MEMBER',
      committees: [
        { committeeMembershipId: 'cm1', committeeId: A1, role: 'LEAD' },
        { committeeMembershipId: 'cm2', committeeId: A2, role: 'MEMBER' },
      ],
    },
  ],
};
const plainMember: Actor = {
  userId: 'member',
  isFullAdmin: false,
  memberships: [
    {
      membershipId: 'm3',
      clubId: CLUB_A,
      role: 'MEMBER',
      committees: [{ committeeMembershipId: 'cm3', committeeId: A1, role: 'MEMBER' }],
    },
  ],
};

function reasonOf(act: () => void): string | undefined {
  try {
    act();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthzError);
    return (error as AuthzError).reason;
  }
}

describe('writing points in a committee', () => {
  const inA1 = { clubId: CLUB_A, committeeId: A1 };
  const inA2 = { clubId: CLUB_A, committeeId: A2 };
  const inB = { clubId: CLUB_B, committeeId: 'committee-b1' };

  it('is open to a full admin anywhere, and to an officer anywhere in their club', () => {
    expect(reasonOf(() => assertCanWritePoints(admin, inB))).toBeUndefined();
    expect(reasonOf(() => assertCanWritePoints(officerA, inA1))).toBeUndefined();
    expect(reasonOf(() => assertCanWritePoints(officerA, inA2))).toBeUndefined();
  });

  it('is open to a lead in the committee they lead', () => {
    expect(reasonOf(() => assertCanWritePoints(leadA1, inA1))).toBeUndefined();
  });

  it('is closed to a lead in a committee they are only a member of', () => {
    expect(reasonOf(() => assertCanWritePoints(leadA1, inA2))).toBe('points_management_required');
  });

  it('is closed to an officer of another club and to a plain member', () => {
    expect(reasonOf(() => assertCanWritePoints(officerA, inB))).toBe('points_management_required');
    expect(reasonOf(() => assertCanWritePoints(plainMember, inA1))).toBe(
      'points_management_required',
    );
  });
});
