import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import { assertCanReadRoles, assertCanSetClubRole, assertCanSetCommitteeRole } from '../policies';

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const A1 = 'committee-a1';

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
      committees: [{ committeeMembershipId: 'cm1', committeeId: A1, role: 'LEAD' }],
    },
  ],
};
const plainMember: Actor = {
  userId: 'member',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm3', clubId: CLUB_A, role: 'MEMBER', committees: [] }],
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

describe('club officers', () => {
  it('are appointed by full admins only', () => {
    expect(reasonOf(() => assertCanSetClubRole(admin))).toBeUndefined();
    for (const actor of [officerA, leadA1, plainMember]) {
      expect(reasonOf(() => assertCanSetClubRole(actor))).toBe('full_admin_required');
    }
  });

  it('refuse an officer even for their own role — there is no separate self rule', () => {
    // officerA asking about officerA: the same refusal as about anyone else.
    expect(reasonOf(() => assertCanSetClubRole(officerA))).toBe('full_admin_required');
  });
});

describe('committee leads', () => {
  it('are appointed by the club’s officers and by full admins', () => {
    expect(reasonOf(() => assertCanSetCommitteeRole(admin, CLUB_B))).toBeUndefined();
    expect(reasonOf(() => assertCanSetCommitteeRole(officerA, CLUB_A))).toBeUndefined();
  });

  it('are not appointed by a lead, a plain member, or an officer of another club', () => {
    for (const actor of [leadA1, plainMember]) {
      expect(reasonOf(() => assertCanSetCommitteeRole(actor, CLUB_A))).toBe(
        'club_management_required',
      );
    }
    expect(reasonOf(() => assertCanSetCommitteeRole(officerA, CLUB_B))).toBe(
      'club_management_required',
    );
  });
});

describe('reading roles and their history', () => {
  it('is open to the club’s officers and full admins', () => {
    expect(reasonOf(() => assertCanReadRoles(admin, CLUB_B))).toBeUndefined();
    expect(reasonOf(() => assertCanReadRoles(officerA, CLUB_A))).toBeUndefined();
  });

  it('is closed to a lead of that very club, and to plain members', () => {
    for (const actor of [leadA1, plainMember]) {
      expect(reasonOf(() => assertCanReadRoles(actor, CLUB_A))).toBe('club_management_required');
    }
  });
});
