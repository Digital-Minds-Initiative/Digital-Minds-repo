import 'server-only';

import { clubsScope, committeesScope, type Actor } from '@/server/authz';

import { findClubRefs, findCommitteeRefs, type ClubRef, type CommitteeRef } from './repository';

/** Active clubs the actor can open in the dashboard. */
export async function listAccessibleClubs(actor: Actor): Promise<ClubRef[]> {
  return findClubRefs(clubsScope(actor), { includeArchived: false });
}

/** Active committees the actor manages (all committees of their clubs, plus the ones they lead). */
export async function listAccessibleCommittees(actor: Actor): Promise<CommitteeRef[]> {
  return findCommitteeRefs(committeesScope(actor), { includeArchived: false });
}
