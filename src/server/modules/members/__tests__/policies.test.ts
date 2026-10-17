import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import {
  assertCanAddMember,
  assertCanAddToCommittee,
  assertCanChangeMembershipType,
  assertCanEditClubFields,
  assertCanEditFullName,
  assertCanEditUniEmail,
  assertCanImportMembers,
  assertCanRemoveFromClub,
  assertCanRemoveFromCommittee,
} from '../policies';

/*
 * The rules of docs/adr/0017-member-permissions.md as pure functions. The scopes decide what each
 * actor sees at all; these only answer "may this actor do it to a member they can already see".
 */

const CLUB = 'club-a';
const OTHER_CLUB = 'club-b';
const OWN = 'committee-own';
const OTHER = 'committee-other';

const admin: Actor = { userId: 'admin', isFullAdmin: true, memberships: [] };
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
const member: Actor = {
  userId: 'member',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm3', clubId: CLUB, role: 'MEMBER', committees: [] }],
};

/** Every club-level action, so a new one cannot be forgotten here. */
const clubActions = {
  add: (actor: Actor, clubId: string) => assertCanAddMember(actor, clubId),
  editClubFields: (actor: Actor, clubId: string) => assertCanEditClubFields(actor, clubId),
  editFullName: (actor: Actor, clubId: string) => assertCanEditFullName(actor, clubId),
  addToCommittee: (actor: Actor, clubId: string) => assertCanAddToCommittee(actor, clubId),
  removeFromCommittee: (actor: Actor, clubId: string) =>
    assertCanRemoveFromCommittee(actor, clubId),
  removeFromClub: (actor: Actor, clubId: string) => assertCanRemoveFromClub(actor, clubId),
  importMembers: (actor: Actor, clubId: string) => assertCanImportMembers(actor, clubId),
};

describe('club-level actions', () => {
  it('are allowed for a full admin and for the club’s officer', () => {
    for (const [name, action] of Object.entries(clubActions)) {
      expect(() => action(admin, CLUB), name).not.toThrow();
      expect(() => action(officer, CLUB), name).not.toThrow();
    }
  });

  it('are refused for a committee lead, an ordinary member and another club’s officer', () => {
    for (const [name, action] of Object.entries(clubActions)) {
      for (const actor of [lead, member]) {
        expect(() => action(actor, CLUB), name).toThrow(AuthzError);
      }
      expect(() => action(officer, OTHER_CLUB), name).toThrow(AuthzError);
    }
  });

  it('refuse with club_management_required, so the UI can explain them alike', () => {
    for (const [name, action] of Object.entries(clubActions)) {
      try {
        action(lead, CLUB);
        expect.unreachable(`${name} should have thrown`);
      } catch (error) {
        expect((error as AuthzError).reason, name).toBe('club_management_required');
      }
    }
  });
});

describe('the university email', () => {
  it('can be corrected by an officer while the person has not registered', () => {
    expect(() =>
      assertCanEditUniEmail(officer, { clubId: CLUB, isRegistered: false }),
    ).not.toThrow();
  });

  it('needs a full admin once the person has registered', () => {
    expect(() => assertCanEditUniEmail(admin, { clubId: CLUB, isRegistered: true })).not.toThrow();
    try {
      assertCanEditUniEmail(officer, { clubId: CLUB, isRegistered: true });
      expect.unreachable('an officer cannot change a registered email');
    } catch (error) {
      expect((error as AuthzError).reason).toBe('uni_email_requires_full_admin');
    }
  });

  it('is never a lead’s or a member’s to change', () => {
    for (const actor of [lead, member]) {
      for (const isRegistered of [true, false]) {
        expect(() => assertCanEditUniEmail(actor, { clubId: CLUB, isRegistered })).toThrow(
          AuthzError,
        );
      }
    }
  });
});

describe('the membership type', () => {
  const inOwnCommittee = { clubId: CLUB, committeeIds: [OWN] };
  const elsewhere = { clubId: CLUB, committeeIds: [OTHER] };

  it('can be changed by a full admin and the club’s officer, anywhere in the club', () => {
    for (const actor of [admin, officer]) {
      expect(() => assertCanChangeMembershipType(actor, inOwnCommittee)).not.toThrow();
      expect(() => assertCanChangeMembershipType(actor, elsewhere)).not.toThrow();
      expect(() =>
        assertCanChangeMembershipType(actor, { clubId: CLUB, committeeIds: [] }),
      ).not.toThrow();
    }
  });

  it('can be changed by the lead of a committee the member is in', () => {
    expect(() => assertCanChangeMembershipType(lead, inOwnCommittee)).not.toThrow();
  });

  it('cannot be changed by a lead for a member outside their committees', () => {
    // The scopes make such a member a 404 first; this is the rule behind that.
    try {
      assertCanChangeMembershipType(lead, elsewhere);
      expect.unreachable('a lead has no say outside their committees');
    } catch (error) {
      expect((error as AuthzError).reason).toBe('membership_type_change_not_allowed');
    }
    expect(() => assertCanChangeMembershipType(lead, { clubId: CLUB, committeeIds: [] })).toThrow(
      AuthzError,
    );
  });

  it('cannot be changed by an ordinary member', () => {
    expect(() => assertCanChangeMembershipType(member, inOwnCommittee)).toThrow(AuthzError);
  });
});
