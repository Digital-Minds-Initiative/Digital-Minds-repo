import 'server-only';

import { assertCanAppointLeads, assertCanAppointOfficers, type Actor } from '@/server/authz';

/** Appointing or revoking a club officer (مدير شؤون): full admins only. */
export function assertCanSetClubRole(actor: Actor): void {
  assertCanAppointOfficers(actor);
}

/** Appointing or revoking a committee lead (قائد لجنة): officers of that club and full admins. */
export function assertCanSetCommitteeRole(actor: Actor, clubId: string): void {
  assertCanAppointLeads(actor, clubId);
}
