import 'server-only';

import { AuthzError, canManageClub, type Actor } from '@/server/authz';

/*
 * Who may grant and revoke roles (docs/adr/0018-granting-roles.md).
 *
 * Club officers are appointed by full admins only: an officer runs their club, they do not decide
 * who else runs it. Committee leads are appointed by the club's own officers, because who leads a
 * committee is how an officer organises the club's work.
 *
 * There is no rule about changing your own role, because there is nothing it could add: an
 * officer cannot change any club role, so their own is refused like anyone else's; a full admin
 * demoting their own officer row keeps the full-admin flag, which the API cannot touch at all;
 * and an officer appointing themselves a lead gains nothing they do not already hold over every
 * committee of their club.
 *
 * Reading has no scope-free policy: anything outside the actor's scope is a 404, decided before
 * these checks run.
 */

/** Appointing and revoking club officers. */
export function assertCanSetClubRole(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('full_admin_required');
}

/** Appointing and revoking committee leads, inside one club. */
export function assertCanSetCommitteeRole(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}

/**
 * Reading a club's role history and who currently holds which role. A committee lead runs their
 * committee's work; who was appointed when is the club's business, so they see none of it.
 */
export function assertCanReadRoles(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}
