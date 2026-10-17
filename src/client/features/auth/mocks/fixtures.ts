import {
  canManageClub,
  canSeeCommittee,
  must,
  type MockActor,
  type MockDb,
} from '@/client/mocks/db';
import type { Me, SignInStep } from '@/shared/contracts/auth';

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
  // Like the server's `listAccessibleClubs`: archived clubs and committees are not offered.
  const clubs = db.clubs
    .filter(
      (club) =>
        club.archivedAt === null && (canManageClub(actor, club.id) || leadClubIds.has(club.id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const committees = db.committees
    .filter(
      (committee) =>
        committee.archivedAt === null &&
        db.clubsById.get(committee.clubId)?.archivedAt === null &&
        canSeeCommittee(actor, committee.clubId, committee.id),
    )
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

/** What a correct code leads to for this address in the demo data. */
export function mockSignInStep(db: MockDb, email: string): SignInStep {
  const user = db.users.find((candidate) => candidate.uniEmail === email);
  if (!user) return { step: 'enter_name' };
  return user.registered
    ? { step: 'signed_in' }
    : { step: 'confirm_name', fullName: user.fullName };
}

/**
 * The name step: registers the demo persona, or adds a new person with no memberships. An
 * admin-added persona keeps the stored name — the confirm step cannot change it (the handler
 * refuses a different one first).
 */
export function registerMockUser(db: MockDb, email: string, fullName: string): void {
  const existing = db.users.find((candidate) => candidate.uniEmail === email);
  if (existing) {
    existing.registered = true;
    return;
  }
  const user: MockDb['users'][number] = {
    id: crypto.randomUUID(),
    key: email,
    publicId: crypto.randomUUID().replaceAll('-', ''),
    fullName,
    uniEmail: email,
    isFullAdmin: false,
    registered: true,
    persona: 'member',
  };
  db.users.push(user);
  db.usersById.set(user.id, user);
}
