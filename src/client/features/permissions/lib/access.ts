import type { Me } from '@/shared/contracts/auth';

/**
 * What the signed-in person may do with roles in one club, from `/me`. It only decides what the
 * screen offers — the server refuses everything else again, so hiding a button is never the
 * protection (docs/adr/0018-granting-roles.md):
 *
 *   full admin ........ appoints and revokes club officers and committee leads, reads both lists
 *   club officer ...... appoints and revokes committee leads in their own club, reads both lists
 *   committee lead .... nothing: no lists, no history
 */
export interface RoleAccess {
  role: 'fullAdmin' | 'officer';
  canSetOfficers: boolean;
  canSetLeads: boolean;
}

/** The clubs whose roles the person may open: every club for an admin, their own for an officer. */
export function manageableClubs(me: Me): Me['access']['clubs'] {
  return me.access.clubs.filter((club) => club.canManage);
}

export function roleAccess(me: Me): RoleAccess {
  return me.user.isFullAdmin
    ? { role: 'fullAdmin', canSetOfficers: true, canSetLeads: true }
    : { role: 'officer', canSetOfficers: false, canSetLeads: true };
}
