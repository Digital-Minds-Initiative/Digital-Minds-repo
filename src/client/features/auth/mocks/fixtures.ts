import {
  canManageClub,
  canSeeCommittee,
  must,
  type MockActor,
  type MockDb,
} from '@/client/mocks/db';
import type { Me } from '@/shared/contracts/auth';

/** The `GET /me` response for a mock persona. */
export function buildMeFixture(db: MockDb, actor: MockActor): Me {
  const own = db.memberships.filter(
    (membership) => membership.userId === actor.user.id && membership.removedAt === null,
  );
  const leadClubIds = new Set(
    own
      .filter((membership) => membership.committees.some((c) => c.role === 'LEAD' && !c.removed))
      .map((membership) => membership.clubId),
  );
  const clubs = db.clubs
    .filter((club) => canManageClub(actor, club.id) || leadClubIds.has(club.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const committees = db.committees
    .filter((committee) => canSeeCommittee(actor, committee.clubId, committee.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  return {
    user: {
      id: actor.user.id,
      fullName: actor.user.fullName,
      uniEmail: actor.user.uniEmail,
      isFullAdmin: actor.user.isFullAdmin,
    },
    memberships: own.map((membership) => {
      const club = must(db.clubsById.get(membership.clubId), 'club');
      const type = must(db.membershipTypesById.get(membership.typeId), 'membership type');
      return {
        club: { id: club.id, name: club.name, slug: club.slug },
        role: membership.role,
        membershipType: { id: type.id, name: type.name },
        committees: membership.committees
          .filter((committee) => !committee.removed)
          .map((committee) => ({
            id: committee.committeeId,
            name: must(db.committeesById.get(committee.committeeId), 'committee').name,
            role: committee.role,
          })),
      };
    }),
    access: {
      canAccessDashboard:
        actor.user.isFullAdmin ||
        actor.officerClubIds.length > 0 ||
        actor.ledCommitteeIds.length > 0,
      canManageClubs: actor.user.isFullAdmin,
      clubs: clubs.map((club) => ({
        id: club.id,
        name: club.name,
        slug: club.slug,
        canManage: canManageClub(actor, club.id),
      })),
      committees: committees.map((committee) => ({
        id: committee.id,
        clubId: committee.clubId,
        name: committee.name,
      })),
    },
  };
}
