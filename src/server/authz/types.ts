import 'server-only';

import type { ClubRole, CommitteeRole } from '@/server/db/generated/enums';

export type { ClubRole, CommitteeRole };

/** One active committee membership of the actor. */
export interface ActorCommitteeMembership {
  readonly committeeMembershipId: string;
  readonly committeeId: string;
  readonly role: CommitteeRole;
}

/** One active club membership of the actor, with its active committee memberships. */
export interface ActorMembership {
  readonly membershipId: string;
  readonly clubId: string;
  readonly role: ClubRole;
  readonly committees: readonly ActorCommitteeMembership[];
}

/**
 * Who is making the request and what they hold. Built once per request by `resolveActor`
 * (src/server/actor.ts) and passed as the first argument to every service function.
 *
 * Removed memberships and removed committee memberships are never loaded into an Actor, so they
 * grant nothing — even if a stale role is still stored on the row.
 */
export interface Actor {
  readonly userId: string;
  readonly isFullAdmin: boolean;
  readonly memberships: readonly ActorMembership[];
}

/** A committee identified together with its club (officer rights are per club). */
export interface CommitteeTarget {
  readonly clubId: string;
  readonly committeeId: string;
}
