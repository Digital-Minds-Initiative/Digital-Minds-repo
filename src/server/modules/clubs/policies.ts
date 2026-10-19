import 'server-only';

import {
  AuthzError,
  canManageClub,
  canManageCommittee,
  type Actor,
  type CommitteeTarget,
} from '@/server/authz';

/*
 * What an actor may do with clubs, committees and membership types.
 *
 * Clubs and committees are the shape of the whole organisation, so only full admins create,
 * rename, archive and restore them — an officer runs their club, they do not decide which clubs
 * and committees exist. Membership types are a club's own vocabulary, so that club's officers
 * own them. Committee leads manage neither; they only read (through the scopes).
 *
 * Reading has no policy: the scopes in src/server/authz decide what each actor sees, and
 * anything outside them is a 404. The one exception is a committee's view link, which a lead may
 * manage as well as read (ADR 0023).
 */

/** Creating, renaming, archiving and restoring clubs and committees. */
export function assertCanManageClubsAndCommittees(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('full_admin_required');
}

/** Adding, renaming, deleting and reordering one club's membership types. */
export function assertCanManageMembershipTypes(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}

/**
 * Reading, creating, renewing and turning off a committee's public view link (ADR 0023): the
 * committee's lead, the club's officers, full admins. The lead manages their own link because
 * sharing a committee's points with its members is part of running that committee.
 *
 * Like `assertCanWritePoints`, no request can actually reach this refusal: `committeesScope`
 * contains exactly the committees of clubs the actor manages and the committees they lead, so
 * anyone who gets past the 404 can manage this committee. It is here because the service must
 * not depend on that, and it is unit-tested instead of integration-tested.
 */
export function assertCanManageViewLink(actor: Actor, target: CommitteeTarget): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('committee_management_required');
}
