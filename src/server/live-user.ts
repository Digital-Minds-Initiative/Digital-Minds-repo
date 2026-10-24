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
