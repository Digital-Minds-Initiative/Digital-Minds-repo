import 'server-only';

/**
 * The university email of a person who has not been deleted.
 *
 * `User.uniEmail` is null only on a deleted person (docs/adr/0026-person-deletion.md), and a
 * deleted person has no memberships, no sessions and no actor — so every read that reaches a
 * User through one of those holds an address. This says so to the type checker, and fails loudly
 * (a 500, not a wrong answer) if that ever stops being true.
 */
export function liveUniEmail(uniEmail: string | null): string {
  if (uniEmail === null) throw new Error('Reached a deleted person through a live row.');
  return uniEmail;
}

/**
 * The name to show for whoever wrote a history row (recorded or cancelled a transaction, edited
 * one, granted a role): null once a full admin deleted that person's data, which the UI shows as
 * «عضو محذوف». The emptied row still holds `fullName: ''`; this keeps that from reaching a screen
 * as a blank.
 */
export function authorName(user: { fullName: string; deletedAt: Date | null }): string | null {
  return user.deletedAt === null ? user.fullName : null;
}
