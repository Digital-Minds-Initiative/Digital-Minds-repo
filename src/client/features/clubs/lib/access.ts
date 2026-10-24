import type { Me } from '@/shared/contracts/auth';

/**
 * What the signed-in person may do in one club, from `/me`. It only decides what the screen
 * offers: the server refuses everything else again, so hiding a button is never the protection.
 *
 * The roles differ per club — someone can run one club and lead a committee in another — so this
 * is asked per club, never once for the whole screen:
 *   fullAdmin  every club; creates, renames, archives and restores clubs and committees, and
 *              deletes an empty club or any committee (ADR 0015)
 *   officer    their club: its membership types; reads every committee
 *   lead       reads the club, the committees they lead and the membership types
 */
export interface ClubAccess {
  role: 'fullAdmin' | 'officer' | 'lead';
  /** Create, rename, archive and restore the club and its committees. */
  canManageStructure: boolean;
  /** Add, rename, delete and reorder membership types. */
  canManageTypes: boolean;
  /** Delete the club (when empty) and its committees, for good. */
  canDelete: boolean;
}

export function clubAccess(me: Me, clubId: string): ClubAccess {
  if (me.user.isFullAdmin) {
    return { role: 'fullAdmin', canManageStructure: true, canManageTypes: true, canDelete: true };
  }
  const officer = me.memberships.some(
    (membership) => membership.club.id === clubId && membership.role === 'CLUB_OFFICER',
  );
  return officer
    ? { role: 'officer', canManageStructure: false, canManageTypes: true, canDelete: false }
    : { role: 'lead', canManageStructure: false, canManageTypes: false, canDelete: false };
}
