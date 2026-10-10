import 'server-only';

import {
  assertCanManageClub,
  assertCanManageCommittee,
  assertFullAdmin,
  type Actor,
  type CommitteeTarget,
} from '@/server/authz';

/*
 * What an actor may do in the clubs module. Each rule maps an action to a level of the
 * hierarchy; the hierarchy itself lives in src/server/authz.
 */

/** Creating and archiving clubs. */
export function assertCanCreateOrArchiveClub(actor: Actor): void {
  assertFullAdmin(actor);
}

/** Editing a club's name and description, its committees and its membership types. */
export function assertCanConfigureClub(actor: Actor, clubId: string): void {
  assertCanManageClub(actor, clubId);
}

/** Rotating or disabling a committee's public view link. */
export function assertCanManageViewLink(actor: Actor, target: CommitteeTarget): void {
  assertCanManageClub(actor, target.clubId);
}

/** Reading (and sharing) a committee's current view link: its lead may do this too. */
export function assertCanReadViewLink(actor: Actor, target: CommitteeTarget): void {
  assertCanManageCommittee(actor, target);
}
