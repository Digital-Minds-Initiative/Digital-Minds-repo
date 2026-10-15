import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import { assertCanManageClubsAndCommittees, assertCanManageMembershipTypes } from '../policies';

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

describe('clubs and committees', () => {
  it('are managed by full admins only', () => {
    expect(reasonOf(() => assertCanManageClubsAndCommittees(admin))).toBeUndefined();
    for (const actor of [officerA, leadA1, plainMember]) {
      expect(reasonOf(() => assertCanManageClubsAndCommittees(actor))).toBe('full_admin_required');
    }
  });
});

describe('membership types', () => {
  it('are managed by the club’s officers and full admins', () => {
    expect(reasonOf(() => assertCanManageMembershipTypes(admin, CLUB_B))).toBeUndefined();
    expect(reasonOf(() => assertCanManageMembershipTypes(officerA, CLUB_A))).toBeUndefined();
  });

  it('are not managed by leads, plain members, or officers of another club', () => {
    for (const actor of [leadA1, plainMember]) {
      expect(reasonOf(() => assertCanManageMembershipTypes(actor, CLUB_A))).toBe(
        'club_management_required',
      );
    }
    expect(reasonOf(() => assertCanManageMembershipTypes(officerA, CLUB_B))).toBe(
      'club_management_required',
    );
  });
});
