import 'server-only';

import { AuthzError, canManageClub, isLeadOf, type Actor } from '@/server/authz';

/*
 * What an actor may do with members (docs/adr/0017-member-permissions.md).
 *
 * A club's membership is run by its officers and by full admins: they add people, edit this
 * club's copy of their details, move them between committees, change their type and remove them.
 *
 * Committee leads read the members of the committees they lead (through the scopes) and may
 * change their membership type — nothing else. Types are club-level, so that one change applies
 * to the whole club membership; it is still the lead's call, because the lead already sees and
 * runs that member's work.
 *
 * Nobody edits their own name or university email here: those belong to the shared account, and
 * an ordinary member sees no member at all (the scopes make every member a 404 for them).
 *
 * Reading has no policy: the scopes in src/server/authz decide what each actor sees, and anything
 * outside them is a 404 — thrown before any of these checks runs.
 */

/** A member as the policies see it: their club and the committees visible to the actor. */
export interface MemberTarget {
  clubId: string;
  committeeIds: readonly string[];
}

/** Everything club-level: one rule, one reason, so the UI can treat them alike. */
function assertClubManagement(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}

/** Adding a person to the club, in any committees of it and with any of its membership types. */
export function assertCanAddMember(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

/** This club's copy of the contact and study details: phone, personal email, college, major, level. */
export function assertCanEditClubFields(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

/** The name on the shared account — it shows in every club the person belongs to. */
export function assertCanEditFullName(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

/**
 * The university email is the identity sign-in matches on. An officer may correct it while the
 * person has not signed in yet; once they have registered, moving the account to another address
 * is a full admin's call (and ends every session the person has).
 */
export function assertCanEditUniEmail(
  actor: Actor,
  target: { clubId: string; isRegistered: boolean },
): void {
  if (actor.isFullAdmin) return;
  assertClubManagement(actor, target.clubId);
  if (target.isRegistered) throw new AuthzError('uni_email_requires_full_admin');
}

/** The one member action a committee lead has, for the members of the committees they lead. */
export function assertCanChangeMembershipType(actor: Actor, member: MemberTarget): void {
  if (canManageClub(actor, member.clubId)) return;
  if (!member.committeeIds.some((committeeId) => isLeadOf(actor, committeeId))) {
    throw new AuthzError('membership_type_change_not_allowed');
  }
}

/** Committees belong to the club, so moving people between them is a club-level action. */
export function assertCanAddToCommittee(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

/** Including another lead: an officer may take anyone out of a committee. */
export function assertCanRemoveFromCommittee(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

export function assertCanRemoveFromClub(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}
