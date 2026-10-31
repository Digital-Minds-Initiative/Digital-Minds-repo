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
 *   committee lead ............... the membership type of members in their committees, and adding
 *                                  people to a committee they lead (ADR 0029) — never removing
 *   the name and the email ........ on the account every club shares: an officer only for someone
 *                                  holding no role (and, for the email, not registered yet);
 *                                  otherwise a full admin. The server also refuses an account
 *                                  that reaches another club, which this page cannot see — that
 *                                  refusal is shown when the form is sent.
 */
export interface MemberAccess {
  /** Add to and remove from committees and the club; edit this club's details. */
  canManage: boolean;
  canEditName: boolean;
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
  const holdsRole =
    member.role !== 'MEMBER' || member.committees.some((committee) => committee.role !== 'MEMBER');
  const editsAccount = me.user.isFullAdmin || (manages && !holdsRole);
  return {
    canManage: manages,
    canEditName: editsAccount,
    canEditEmail: me.user.isFullAdmin || (editsAccount && !member.user.isRegistered),
    canChangeType: manages || leadsOne,
  };
}

/** The clubs the person may add members to: every club for a full admin, their own for an officer. */
export function clubsToAddTo(me: Me): Me['access']['clubs'] {
  return me.access.clubs.filter((club) => club.canManage);
}

/** A committee a lead may bring people into, with its club for the label. */
export interface AdmittingCommittee {
  id: string;
  name: string;
  clubName: string;
}

/**
 * The committees the person leads in clubs they do not run — where they add people one committee
 * at a time, always with «عضو» (docs/adr/0029-leads-add-members.md). In a club they run they use
 * the officers' add instead, which can do everything this can.
 */
export function committeesToAddTo(me: Me): AdmittingCommittee[] {
  if (me.user.isFullAdmin) return [];
  const managed = new Set(clubsToAddTo(me).map((club) => club.id));
  return me.memberships
    .filter((membership) => !managed.has(membership.club.id))
    .flatMap((membership) =>
      membership.committees
        .filter((committee) => committee.role === 'LEAD')
        .map((committee) => ({
          id: committee.id,
          name: committee.name,
          clubName: membership.club.name,
        })),
    );
}
