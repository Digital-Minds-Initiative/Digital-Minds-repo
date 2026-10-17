import type { Me } from '@/shared/contracts/auth';

/**
 * Whether the signed-in person may add, edit or cancel points in one committee of one club — the
 * same rule as the server's `assertCanWritePoints`: the committee's lead, an officer of its club,
 * or a full admin. It only decides which buttons are drawn; the server refuses the rest again.
 */
export function canWritePoints(me: Me, clubId: string, committeeId: string): boolean {
  if (me.user.isFullAdmin) return true;
  return me.memberships.some(
    (membership) =>
      membership.club.id === clubId &&
      (membership.role === 'CLUB_OFFICER' ||
        membership.committees.some(
          (committee) => committee.id === committeeId && committee.role === 'LEAD',
        )),
  );
}

/** Whether the person sees every committee of the club (admin or officer), not only the ones they lead. */
export function seesWholeClub(me: Me, clubId: string): boolean {
  return (
    me.user.isFullAdmin ||
    me.memberships.some(
      (membership) => membership.club.id === clubId && membership.role === 'CLUB_OFFICER',
    )
  );
}
