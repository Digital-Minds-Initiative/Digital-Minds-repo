import 'server-only';

import {
  AuthzError,
  canManageClub,
  canManageCommittee,
  isLeadOf,
  type Actor,
} from '@/server/authz';

/*
 * What an actor may do with members (docs/adr/0017-member-permissions.md).
 *
 * A club's membership is run by its officers and by full admins: they add people, edit this
 * club's copy of their details, move them between committees, change their type and remove them.
 *
 * Committee leads read the members of the committees they lead (through the scopes), may change
 * their membership type, and may bring people into a committee they lead (ADR 0029) — nothing
 * else: no removing, no profile edits, no other committee. Types are club-level, so a type change
 * applies to the whole club membership; it is still the lead's call, because the lead already
 * sees and runs that member's work.
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

/**
 * Importing a file of members: the same rule as adding them one at a time, and the same reason,
 * so a file is never a way round it (docs/adr/0021-csv-member-import.md). The preview is checked
 * too: it is nothing but the first half of the same action.
 */
export function assertCanImportMembers(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

/** This club's copy of the contact and study details: phone, personal email, college, major, level, gender. */
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

/**
 * Bringing a person into one committee — new to the club, removed from it, or a member who is not
 * in this committee yet — with the club's «عضو» type and nothing else
 * (docs/adr/0029-leads-add-members.md). Its leads may, as well as the club's officers and full
 * admins. A lead of another committee never gets here: the committee is outside their scope, so
 * it is a 404 first, and this is the guard that documents the rule.
 */
export function assertCanAdmitToCommittee(
  actor: Actor,
  target: { clubId: string; committeeId: string },
): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('committee_management_required');
}

/** Including another lead: an officer may take anyone out of a committee. */
export function assertCanRemoveFromCommittee(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}

export function assertCanRemoveFromClub(actor: Actor, clubId: string): void {
  assertClubManagement(actor, clubId);
}
