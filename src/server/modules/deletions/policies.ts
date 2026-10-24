import 'server-only';

import { AuthzError, type Actor } from '@/server/authz';

/*
 * Who may delete. Archiving clubs and committees and removing members stay the default; deleting
 * for good is a full admin's alone (docs/adr/0015-archive-instead-of-delete.md). Officers and
 * committee leads reach these refusals for what they can see; what they cannot see is a 404
 * before any of this runs.
 */

/** Deleting a club, a committee or a person's data. */
export function assertCanDelete(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('full_admin_required');
}

/**
 * A full admin deletes neither their own data nor another full admin's
 * (docs/adr/0026-person-deletion.md). A compromised admin account must not be able to wipe the
 * other admins, so removing a full admin stays a script-only operation, like granting the flag.
 */
export function assertCanDeletePerson(
  actor: Actor,
  person: { userId: string; isFullAdmin: boolean },
): void {
  if (person.userId === actor.userId) throw new AuthzError('cannot_delete_self');
  if (person.isFullAdmin) throw new AuthzError('cannot_delete_full_admin');
}
