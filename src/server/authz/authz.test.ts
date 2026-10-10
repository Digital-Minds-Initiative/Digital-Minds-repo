import { describe, expect, it } from 'vitest';

import {
  assertCanAppointLeads,
  assertCanAppointOfficers,
  assertCanManageClub,
  assertCanManageCommittee,
  assertCanManagePoints,
  AuthzError,
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  hasDashboardAccess,
  membersScope,
  pointTransactionsScope,
  type Actor,
} from './index';

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
      membersScope,
      committeeMembershipsScope,
      pointTransactionsScope,
    ]) {
      expect(build(admin)).toEqual({});
    }
  });

  it('fail closed for actors without a management role', () => {
    for (const actor of [nobody, plainMember]) {
      for (const build of [
        clubsScope,
        committeesScope,
        membersScope,
        committeeMembershipsScope,
        pointTransactionsScope,
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
  });

  it('give a mixed actor officer scope in A and nothing in B', () => {
    const scope = JSON.stringify(membersScope(mixed));
    expect(scope).toContain(CLUB_A);
    expect(scope).not.toContain(CLUB_B);
    expect(scope).not.toContain(B1);
  });
});

describe('role hierarchy', () => {
  const inA1 = { clubId: CLUB_A, committeeId: A1 };
  const inA2 = { clubId: CLUB_A, committeeId: A2 };
  const inB1 = { clubId: CLUB_B, committeeId: B1 };

  it('lets each level manage its own scope and everything below it', () => {
    expect(() => assertCanManageClub(admin, CLUB_B)).not.toThrow();
    expect(() => assertCanManagePoints(admin, inB1)).not.toThrow();
    expect(() => assertCanManageClub(officerA, CLUB_A)).not.toThrow();
    expect(() => assertCanManagePoints(officerA, inA2)).not.toThrow();
    expect(() => assertCanManagePoints(leadA1, inA1)).not.toThrow();
    expect(() => assertCanManageCommittee(leadA1, inA1)).not.toThrow();
  });

  it('stops at the edge of each scope', () => {
    expect(() => assertCanManageClub(officerA, CLUB_B)).toThrow(AuthzError);
    expect(() => assertCanManagePoints(officerA, inB1)).toThrow(AuthzError);
    expect(() => assertCanManageClub(leadA1, CLUB_A)).toThrow(AuthzError);
    expect(() => assertCanManagePoints(leadA1, inA2)).toThrow(AuthzError);
    expect(() => assertCanManagePoints(mixed, inB1)).toThrow(AuthzError);
    expect(() => assertCanManagePoints(plainMember, inA1)).toThrow(AuthzError);
  });

  it('only full admins appoint officers; officers (not leads) appoint leads', () => {
    expect(() => assertCanAppointOfficers(admin)).not.toThrow();
    expect(() => assertCanAppointOfficers(officerA)).toThrow(AuthzError);
    expect(() => assertCanAppointLeads(officerA, CLUB_A)).not.toThrow();
    expect(() => assertCanAppointLeads(officerA, CLUB_B)).toThrow(AuthzError);
    expect(() => assertCanAppointLeads(leadA1, CLUB_A)).toThrow(AuthzError);
  });

  it('opens the dashboard only to actors with a management role', () => {
    expect(hasDashboardAccess(admin)).toBe(true);
    expect(hasDashboardAccess(officerA)).toBe(true);
    expect(hasDashboardAccess(leadA1)).toBe(true);
    expect(hasDashboardAccess(plainMember)).toBe(false);
    expect(hasDashboardAccess(nobody)).toBe(false);
  });

  it('reports a machine-readable reason', () => {
    try {
      assertCanAppointOfficers(officerA);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthzError);
      expect((error as AuthzError).reason).toBe('officer_appointment_requires_full_admin');
      expect((error as AuthzError).code).toBe('FORBIDDEN');
    }
  });
});
