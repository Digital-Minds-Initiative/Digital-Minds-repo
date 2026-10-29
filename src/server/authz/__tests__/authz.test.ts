import { describe, expect, it } from 'vitest';

import {
  committeeViewMembersScope,
  committeeViewPointsScope,
  canManageClub,
  canManageCommittee,
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  hasDashboardAccess,
  memberAdmissionScope,
  membersScope,
  membershipTypesScope,
  pointTransactionsScope,
  roleChangesScope,
  type Actor,
} from '../index';

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const A1 = 'committee-a1';
const A2 = 'committee-a2';
const B1 = 'committee-b1';

const admin: Actor = { userId: 'admin', isFullAdmin: true, memberships: [] };
const nobody: Actor = { userId: 'nobody', isFullAdmin: false, memberships: [] };
const plainMember: Actor = {
  userId: 'member',
  isFullAdmin: false,
  memberships: [
    {
      membershipId: 'm1',
      clubId: CLUB_A,
      role: 'MEMBER',
      committees: [{ committeeMembershipId: 'cm1', committeeId: A1, role: 'MEMBER' }],
    },
  ],
};
const officerA: Actor = {
  userId: 'officer-a',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm2', clubId: CLUB_A, role: 'CLUB_OFFICER', committees: [] }],
};
const leadA1: Actor = {
  userId: 'lead-a1',
  isFullAdmin: false,
  memberships: [
    {
      membershipId: 'm3',
      clubId: CLUB_A,
      role: 'MEMBER',
      committees: [
        { committeeMembershipId: 'cm3', committeeId: A1, role: 'LEAD' },
        { committeeMembershipId: 'cm4', committeeId: A2, role: 'MEMBER' },
      ],
    },
  ],
};
/** Officer in club A, plain member (in committee B1) in club B. */
const mixed: Actor = {
  userId: 'mixed',
  isFullAdmin: false,
  memberships: [
    { membershipId: 'm4', clubId: CLUB_A, role: 'CLUB_OFFICER', committees: [] },
    {
      membershipId: 'm5',
      clubId: CLUB_B,
      role: 'MEMBER',
      committees: [{ committeeMembershipId: 'cm5', committeeId: B1, role: 'MEMBER' }],
    },
  ],
};

const NO_ROWS = { id: { in: [] } };

describe('scopes', () => {
  it('give full admins everything', () => {
    for (const build of [
      clubsScope,
      committeesScope,
      membershipTypesScope,
      membersScope,
      memberAdmissionScope,
      committeeMembershipsScope,
      pointTransactionsScope,
      roleChangesScope,
    ]) {
      expect(build(admin)).toEqual({});
    }
  });

  it('fail closed for actors without a management role', () => {
    for (const actor of [nobody, plainMember]) {
      for (const build of [
        clubsScope,
        committeesScope,
        membershipTypesScope,
        membersScope,
        memberAdmissionScope,
        committeeMembershipsScope,
        pointTransactionsScope,
        roleChangesScope,
      ]) {
        expect(build(actor)).toEqual(NO_ROWS);
      }
    }
  });

  it('limit officers to their club', () => {
    expect(membersScope(officerA)).toEqual({ OR: [{ clubId: { in: [CLUB_A] } }] });
    expect(pointTransactionsScope(officerA)).toEqual({ OR: [{ clubId: { in: [CLUB_A] } }] });
    expect(committeesScope(officerA)).toEqual({ OR: [{ clubId: { in: [CLUB_A] } }] });
  });

  it('limit leads to members currently in the committee they lead', () => {
    expect(membersScope(leadA1)).toEqual({
      OR: [{ committeeMemberships: { some: { committeeId: { in: [A1] }, removedAt: null } } }],
    });
    expect(pointTransactionsScope(leadA1)).toEqual({ OR: [{ committeeId: { in: [A1] } }] });
    // Being a plain member of A2 grants nothing in A2.
    expect(JSON.stringify(committeesScope(leadA1))).not.toContain(A2);
    expect(clubsScope(leadA1)).toEqual({ id: { in: [CLUB_A] } });
    // Types are club-wide: a lead reads their club's types for filters and dropdowns.
    expect(membershipTypesScope(leadA1)).toEqual({ clubId: { in: [CLUB_A] } });
    // Role history is not: who was appointed when is the club's business, not a lead's, so the
    // lead's own club must not match either (docs/adr/0018-granting-roles.md).
    expect(roleChangesScope(leadA1)).toEqual(NO_ROWS);
  });

  it('give a mixed actor officer scope in A and nothing in B', () => {
    const scope = JSON.stringify(membersScope(mixed));
    expect(scope).toContain(CLUB_A);
    expect(scope).not.toContain(CLUB_B);
    expect(scope).not.toContain(B1);
    expect(memberAdmissionScope(mixed)).toEqual({ clubId: { in: [CLUB_A] } });
  });

  it('let a lead admit any membership of their own club, and nothing in another', () => {
    // Wider than what the lead reads, on purpose: someone not in their committee yet, or removed
    // from the club (docs/adr/0029-leads-add-members.md). The committee scope is the other half.
    expect(memberAdmissionScope(leadA1)).toEqual({ clubId: { in: [CLUB_A] } });
    expect(memberAdmissionScope(officerA)).toEqual({ clubId: { in: [CLUB_A] } });
  });
});

describe('role hierarchy', () => {
  const inA1 = { clubId: CLUB_A, committeeId: A1 };
  const inA2 = { clubId: CLUB_A, committeeId: A2 };
  const inB1 = { clubId: CLUB_B, committeeId: B1 };

  it('lets each level manage its own scope and everything below it', () => {
    expect(canManageClub(admin, CLUB_B)).toBe(true);
    expect(canManageCommittee(admin, inB1)).toBe(true);
    expect(canManageClub(officerA, CLUB_A)).toBe(true);
    expect(canManageCommittee(officerA, inA2)).toBe(true);
    expect(canManageCommittee(leadA1, inA1)).toBe(true);
  });

  it('stops at the edge of each scope', () => {
    expect(canManageClub(officerA, CLUB_B)).toBe(false);
    expect(canManageCommittee(officerA, inB1)).toBe(false);
    expect(canManageClub(leadA1, CLUB_A)).toBe(false);
    expect(canManageCommittee(leadA1, inA2)).toBe(false);
    expect(canManageCommittee(mixed, inB1)).toBe(false);
    expect(canManageCommittee(plainMember, inA1)).toBe(false);
  });

  it('opens the dashboard only to actors with a management role', () => {
    expect(hasDashboardAccess(admin)).toBe(true);
    expect(hasDashboardAccess(officerA)).toBe(true);
    expect(hasDashboardAccess(leadA1)).toBe(true);
    expect(hasDashboardAccess(plainMember)).toBe(false);
    expect(hasDashboardAccess(nobody)).toBe(false);
  });
});

/*
 * The public committee view has no Actor: the view token is the permission, and the scopes built
 * from it name one committee (docs/adr/0023-committee-view-link.md).
 */
describe('scopes granted by a view token', () => {
  it('reach only active members of that one committee', () => {
    expect(committeeViewMembersScope(A1)).toEqual({
      removedAt: null,
      committeeMemberships: { some: { committeeId: A1, removedAt: null } },
    });
  });

  it('reach only the active transactions of that one committee', () => {
    expect(committeeViewPointsScope(A1)).toEqual({ committeeId: A1, status: 'ACTIVE' });
  });

  it('name the committee they were given, and no other', () => {
    expect(committeeViewPointsScope(A2)).not.toEqual(committeeViewPointsScope(A1));
  });
});
