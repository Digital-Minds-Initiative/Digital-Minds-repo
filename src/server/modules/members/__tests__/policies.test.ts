import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import {
  assertCanAddMember,
  assertCanChangeMembershipType,
  assertCanEditMemberProfile,
  assertCanRemoveFromClub,
  assertCanRemoveFromCommittee,
} from '../policies';

const CLUB = 'club-a';
const OWN = 'committee-own';
const OTHER = 'committee-other';

const officer: Actor = {
  userId: 'officer',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm1', clubId: CLUB, role: 'CLUB_OFFICER', committees: [] }],
};
const lead: Actor = {
  userId: 'lead',
  isFullAdmin: false,
  memberships: [
    {
      membershipId: 'm2',
      clubId: CLUB,
      role: 'MEMBER',
      committees: [{ committeeMembershipId: 'cm', committeeId: OWN, role: 'LEAD' }],
    },
  ],
};

const newPerson = (committeeIds: string[]) => ({
  clubId: CLUB,
  committeeIds,
  choosesMembershipType: false,
});

describe('committee leads', () => {
  it('can add people to their own committee', () => {
    expect(() => assertCanAddMember(lead, newPerson([OWN]))).not.toThrow();
  });

  it('cannot add people to the club without their committee, or to another committee', () => {
    expect(() => assertCanAddMember(lead, newPerson([]))).toThrow(AuthzError);
    expect(() => assertCanAddMember(lead, newPerson([OTHER]))).toThrow(AuthzError);
    expect(() => assertCanAddMember(lead, newPerson([OWN, OTHER]))).toThrow(AuthzError);
  });

  it('cannot choose a membership type', () => {
    expect(() =>
      assertCanAddMember(lead, { ...newPerson([OWN]), choosesMembershipType: true }),
    ).toThrow(AuthzError);
  });

  it('can edit profiles of members in their committee only', () => {
    expect(() =>
      assertCanEditMemberProfile(lead, { clubId: CLUB, committeeIds: [OWN] }),
    ).not.toThrow();
    expect(() => assertCanEditMemberProfile(lead, { clubId: CLUB, committeeIds: [OTHER] })).toThrow(
      AuthzError,
    );
  });

  it('can remove members from their committee, but not another lead', () => {
    const target = { clubId: CLUB, committeeId: OWN };
    expect(() =>
      assertCanRemoveFromCommittee(lead, { ...target, memberRole: 'MEMBER' }),
    ).not.toThrow();
    expect(() => assertCanRemoveFromCommittee(lead, { ...target, memberRole: 'LEAD' })).toThrow(
      AuthzError,
    );
    expect(() =>
      assertCanRemoveFromCommittee(lead, {
        clubId: CLUB,
        committeeId: OTHER,
        memberRole: 'MEMBER',
      }),
    ).toThrow(AuthzError);
  });

  it('cannot do club-level actions', () => {
    expect(() => assertCanRemoveFromClub(lead, CLUB)).toThrow(AuthzError);
    expect(() => assertCanChangeMembershipType(lead, CLUB)).toThrow(AuthzError);
  });

  it('are refused with a machine-readable reason', () => {
    try {
      assertCanRemoveFromCommittee(lead, { clubId: CLUB, committeeId: OWN, memberRole: 'LEAD' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthzError);
      expect((error as AuthzError).code).toBe('FORBIDDEN');
      expect((error as AuthzError).reason).toBe('removing_a_lead_requires_officer');
    }
  });
});

describe('club officers', () => {
  it('can do everything inside their club', () => {
    expect(() =>
      assertCanAddMember(officer, { ...newPerson([]), choosesMembershipType: true }),
    ).not.toThrow();
    expect(() =>
      assertCanRemoveFromCommittee(officer, { clubId: CLUB, committeeId: OWN, memberRole: 'LEAD' }),
    ).not.toThrow();
    expect(() => assertCanRemoveFromClub(officer, CLUB)).not.toThrow();
    expect(() => assertCanChangeMembershipType(officer, CLUB)).not.toThrow();
  });

  it('cannot act in another club', () => {
    expect(() => assertCanRemoveFromClub(officer, 'club-b')).toThrow(AuthzError);
    expect(() => assertCanAddMember(officer, { ...newPerson([]), clubId: 'club-b' })).toThrow(
      AuthzError,
    );
  });
});
