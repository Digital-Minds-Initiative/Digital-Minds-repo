import 'server-only';

import { AuthzError, canManageClub, type Actor } from '@/server/authz';

/*
 * What an actor may do with clubs, committees and membership types.
 *
 * Clubs and committees are the shape of the whole organisation, so only full admins create,
 * rename, archive and restore them — an officer runs their club, they do not decide which clubs
 * and committees exist. Membership types are a club's own vocabulary, so that club's officers
 * own them. Committee leads manage neither; they only read (through the scopes).
 *
 * Reading has no policy: the scopes in src/server/authz decide what each actor sees, and
 * anything outside them is a 404.
 */

/** Creating, renaming, archiving and restoring clubs and committees. */
export function assertCanManageClubsAndCommittees(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('full_admin_required');
}

/** Adding, renaming, deleting and reordering one club's membership types. */
export function assertCanManageMembershipTypes(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}
