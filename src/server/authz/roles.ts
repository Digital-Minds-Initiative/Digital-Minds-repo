import 'server-only';

import type { Actor, CommitteeTarget } from './types';

/*
 * The permission hierarchy, as pure functions over the Actor:
 *
 *   full admin   → everything, in every club
 *   club officer → everything inside their club (all its committees)
 *   committee lead → only their committee's members and points
 *
 * Higher levels can do everything lower levels can, within their wider scope.
 * Membership types (مستفيد، عضو فعال…) are descriptive and never appear here.
 */

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Clubs where the actor is a club officer (مدير شؤون). */
export function officerClubIds(actor: Actor): string[] {
  return unique(
    actor.memberships
      .filter((membership) => membership.role === 'CLUB_OFFICER')
      .map((membership) => membership.clubId),
  );
}

/** Committees the actor leads (قائد لجنة). */
export function ledCommitteeIds(actor: Actor): string[] {
  return unique(
    actor.memberships.flatMap((membership) =>
      membership.committees
        .filter((committee) => committee.role === 'LEAD')
        .map((committee) => committee.committeeId),
    ),
  );
}

/** Clubs that contain at least one committee the actor leads. */
export function clubIdsWithLedCommittees(actor: Actor): string[] {
  return unique(
    actor.memberships
      .filter((membership) => membership.committees.some((committee) => committee.role === 'LEAD'))
      .map((membership) => membership.clubId),
  );
}

export function isOfficerOf(actor: Actor, clubId: string): boolean {
  return actor.memberships.some(
    (membership) => membership.clubId === clubId && membership.role === 'CLUB_OFFICER',
  );
}

export function isLeadOf(actor: Actor, committeeId: string): boolean {
  return actor.memberships.some((membership) =>
    membership.committees.some(
      (committee) => committee.committeeId === committeeId && committee.role === 'LEAD',
    ),
  );
}

/** Club-wide management: full admin, or officer of this club. */
export function canManageClub(actor: Actor, clubId: string): boolean {
  return actor.isFullAdmin || isOfficerOf(actor, clubId);
}

/** Committee management (its members and points): club management, or lead of this committee. */
export function canManageCommittee(actor: Actor, target: CommitteeTarget): boolean {
  return canManageClub(actor, target.clubId) || isLeadOf(actor, target.committeeId);
}

/** Whether the actor has any management scope at all (and may open the dashboard). */
export function hasDashboardAccess(actor: Actor): boolean {
  return actor.isFullAdmin || officerClubIds(actor).length > 0 || ledCommitteeIds(actor).length > 0;
}
