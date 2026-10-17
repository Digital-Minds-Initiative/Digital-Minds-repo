import 'server-only';

import {
  AuthzError,
  canManageClub,
  canManageCommittee,
  type Actor,
  type CommitteeTarget,
} from '@/server/authz';

/**
 * Creating, editing and cancelling transactions in a committee: its lead, officers of its club,
 * full admins. Reading follows the same scope (pointTransactionsScope).
 */
export function assertCanWritePoints(actor: Actor, target: CommitteeTarget): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('points_management_required');
}

/**
 * Points across the committees of one club, in one request: the club's officers and full admins
 * only (docs/adr/0022-bulk-points.md). A lead runs the ledger of the committees they lead, so
 * nothing about their own committee is withheld — but choosing who earns across a whole club is a
 * club-level decision, and it carries the club-level reason every other such refusal carries.
 *
 * Unlike `assertCanWritePoints`, this one is reachable: `clubsScope` contains the club of a
 * committee a lead leads, so a lead asking about their own club gets past the 404 and lands here.
 */
export function assertCanWriteClubPoints(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}
