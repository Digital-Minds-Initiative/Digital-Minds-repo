import type { Me } from '@/shared/contracts/auth';
import type { Member } from '@/shared/contracts/members';

/**
 * What the signed-in person may do with one member, from `/me` and the member itself
 * (docs/adr/0017-member-permissions.md). It only decides which buttons and fields are drawn — the
 * server refuses everything else again, so hiding a control is never the protection.
 *
 *   full admin / club officer .... everything about the members of their club: add, edit the
 *                                  club's details and the name, change the type, move between
 *                                  committees, remove
 *   committee lead ............... the membership type of members in their committees, nothing else
 *   the university email ......... an officer only while the person has not registered; after
 *                                  that a full admin (and every session of the person ends)
 */
export interface MemberAccess {
  /** Add to and remove from committees and the club; edit the name and this club's details. */
  canManage: boolean;
  canEditEmail: boolean;
  canChangeType: boolean;
}

export function memberAccess(me: Me, member: Member): MemberAccess {
  const manages =
    me.user.isFullAdmin ||
    me.memberships.some(
      (membership) => membership.club.id === member.club.id && membership.role === 'CLUB_OFFICER',
    );
  const leadsOne = member.committees.some((committee) =>
    me.memberships.some((membership) =>
      membership.committees.some((own) => own.id === committee.id && own.role === 'LEAD'),
    ),
  );
  return {
    canManage: manages,
    canEditEmail: me.user.isFullAdmin || (manages && !member.user.isRegistered),
    canChangeType: manages || leadsOne,
  };
}

/** The clubs the person may add members to: every club for a full admin, their own for an officer. */
export function clubsToAddTo(me: Me): Me['access']['clubs'] {
  return me.access.clubs.filter((club) => club.canManage);
}
