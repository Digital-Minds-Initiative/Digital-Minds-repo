import 'server-only';

import { canManageClub, hasDashboardAccess, selfScope, type Actor } from '@/server/authz';
import { UnauthenticatedError } from '@/server/errors';
import { liveUniEmail } from '@/server/live-user';
import { listAccessibleClubs, listAccessibleCommittees } from '@/server/modules/clubs';
import type { Me } from '@/shared/contracts/auth';

import { findOwnProfile } from './repository';

export async function getMe(actor: Actor): Promise<Me> {
  const [profile, clubs, committees] = await Promise.all([
    findOwnProfile(selfScope(actor)),
    listAccessibleClubs(actor),
    listAccessibleCommittees(actor),
  ]);
  if (!profile) throw new UnauthenticatedError();

  return {
    user: {
      id: profile.id,
      fullName: profile.fullName,
      uniEmail: liveUniEmail(profile.uniEmail),
      isFullAdmin: profile.isFullAdmin,
    },
    memberships: profile.memberships.map((membership) => ({
      club: membership.club,
      role: membership.role,
      membershipType: membership.membershipType,
      committees: membership.committeeMemberships.map((committeeMembership) => ({
        id: committeeMembership.committee.id,
        name: committeeMembership.committee.name,
        role: committeeMembership.role,
      })),
    })),
    access: {
      canAccessDashboard: hasDashboardAccess(actor),
      canManageClubs: actor.isFullAdmin,
      clubs: clubs.map((club) => ({ ...club, canManage: canManageClub(actor, club.id) })),
      committees,
    },
  };
}
