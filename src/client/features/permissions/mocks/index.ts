import { toMemberFixture } from '@/client/features/members/mocks';
import {
  canManageClub,
  findMockActor,
  getMockDb,
  must,
  type MockActor,
  type MockClub,
  type MockDb,
  type MockMembership,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { pageMeta } from '@/shared/contracts/core';
import {
  listClubPermissionsEndpoint,
  listRoleHistoryEndpoint,
  setClubRoleEndpoint,
  setCommitteeRoleEndpoint,
} from '@/shared/contracts/permissions';

/*
 * Mock roles: appointing and revoking officers and leads, who holds what, and the history. The
 * rules follow docs/adr/0018-granting-roles.md — full admins appoint officers, officers appoint
 * leads in their club, a role already held is a no-op that records nothing — and every refusal has
 * the status and `reason` the server gives. The mock actor is rebuilt from the memberships on each
 * request, so a change takes effect on the very next one, like the real thing.
 */

const conflict = (reason: string) => mockError('CONFLICT', reason, { reason });
const forbidden = (reason: string) => mockError('FORBIDDEN', reason, { reason });

type Context = { db: MockDb; actor: MockActor };
const isError = (value: Context | MockError): value is MockError => 'code' in value;

function context(cookies: Record<string, string>): Context | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  return actor ? { db, actor } : mockError('UNAUTHENTICATED');
}

/** The clubs an actor can see at all: the ones they manage and those of committees they lead. */
function visibleClub(db: MockDb, actor: MockActor, clubId: string): MockClub | undefined {
  const club = db.clubsById.get(clubId);
  if (!club) return undefined;
  if (actor.user.isFullAdmin || actor.officerClubIds.includes(club.id)) return club;
  const leadsHere = actor.ledCommitteeIds.some(
    (committeeId) => db.committeesById.get(committeeId)?.clubId === club.id,
  );
  return leadsHere ? club : undefined;
}

/** A member the actor can see: any member of a club they manage, or one in a committee they lead. */
function visibleMembership(db: MockDb, actor: MockActor, memberId: string) {
  const membership = db.memberships.find((candidate) => candidate.id === memberId);
  if (!membership) return undefined;
  const sees =
    canManageClub(actor, membership.clubId) ||
    membership.committees.some((c) => !c.removed && actor.ledCommitteeIds.includes(c.committeeId));
  return sees ? membership : undefined;
}

function holder(db: MockDb, membership: MockMembership) {
  const user = must(db.usersById.get(membership.userId), 'user');
  return { memberId: membership.id, userId: user.id, fullName: user.fullName };
}

function record(
  db: MockDb,
  actor: MockActor,
  change: {
    clubId: string;
    committeeId: string | null;
    membershipId: string;
    previousRole: 'MEMBER' | 'CLUB_OFFICER' | 'LEAD';
    newRole: 'MEMBER' | 'CLUB_OFFICER' | 'LEAD';
  },
): void {
  db.roleChanges.push({
    id: crypto.randomUUID(),
    changedById: actor.user.id,
    createdAt: new Date().toISOString(),
    ...change,
  });
}

export const permissionsHandlers = [
  mockEndpoint(setClubRoleEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = visibleMembership(db, actor, params.memberId);
    if (!membership) return mockError('NOT_FOUND');
    if (!actor.user.isFullAdmin) return forbidden('full_admin_required');
    if (membership.removedAt !== null) return conflict('member_removed');
    if (db.clubsById.get(membership.clubId)?.archivedAt) return conflict('club_archived');

    // Setting the role someone already holds changes nothing and records nothing.
    if (membership.role !== body.role) {
      record(db, actor, {
        clubId: membership.clubId,
        committeeId: null,
        membershipId: membership.id,
        previousRole: membership.role,
        newRole: body.role,
      });
      membership.role = body.role;
    }
    return toMemberFixture(db, actor, membership);
  }),

  mockEndpoint(setCommitteeRoleEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = visibleMembership(db, actor, params.memberId);
    if (!membership) return mockError('NOT_FOUND');
    const committee = db.committeesById.get(params.committeeId);
    const sees =
      committee &&
      (canManageClub(actor, committee.clubId) || actor.ledCommitteeIds.includes(committee.id));
    if (!committee || !sees) return mockError('NOT_FOUND');
    if (committee.clubId !== membership.clubId) {
      return mockError('VALIDATION_FAILED', 'committee_not_in_club', {
        issues: [
          {
            path: ['params', 'committeeId'],
            code: 'committee_not_in_club',
            message: 'committee_not_in_club',
          },
        ],
      });
    }
    if (!canManageClub(actor, committee.clubId)) return forbidden('club_management_required');
    if (membership.removedAt !== null) return conflict('member_removed');
    if (db.clubsById.get(committee.clubId)?.archivedAt) return conflict('club_archived');
    if (committee.archivedAt) return conflict('committee_archived');
    const link = membership.committees.find((c) => c.committeeId === committee.id && !c.removed);
    if (!link) return conflict('not_in_committee');

    if (link.role !== body.role) {
      record(db, actor, {
        clubId: committee.clubId,
        committeeId: committee.id,
        membershipId: membership.id,
        previousRole: link.role,
        newRole: body.role,
      });
      link.role = body.role;
    }
    return toMemberFixture(db, actor, membership);
  }),

  mockEndpoint(listClubPermissionsEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const club = visibleClub(db, actor, params.clubId);
    if (!club) return mockError('NOT_FOUND');
    if (!canManageClub(actor, club.id)) return forbidden('club_management_required');

    const active = db.memberships.filter(
      (membership) => membership.clubId === club.id && membership.removedAt === null,
    );
    const byName = (a: { fullName: string }, b: { fullName: string }) =>
      a.fullName.localeCompare(b.fullName, 'ar');
    return {
      officers: active
        .filter((membership) => membership.role === 'CLUB_OFFICER')
        .map((membership) => holder(db, membership))
        .sort(byName),
      leads: active
        .flatMap((membership) =>
          membership.committees
            .filter((c) => c.role === 'LEAD' && !c.removed)
            .map((c) => {
              const committee = must(db.committeesById.get(c.committeeId), 'committee');
              return {
                ...holder(db, membership),
                committee: { id: committee.id, name: committee.name },
              };
            }),
        )
        .sort((a, b) => a.committee.name.localeCompare(b.committee.name, 'ar') || byName(a, b)),
    };
  }),

  mockEndpoint(listRoleHistoryEndpoint, ({ cookies, params, query }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const club = visibleClub(db, actor, params.clubId);
    if (!club) return mockError('NOT_FOUND');
    if (!canManageClub(actor, club.id)) return forbidden('club_management_required');

    const all = db.roleChanges
      .filter((change) => change.clubId === club.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: all.slice(start, start + query.pageSize).map((change) => {
        const membership = must(
          db.memberships.find((candidate) => candidate.id === change.membershipId),
          'membership',
        );
        const committee = change.committeeId ? db.committeesById.get(change.committeeId) : null;
        const changedBy = must(db.usersById.get(change.changedById), 'user');
        return {
          id: change.id,
          clubId: change.clubId,
          committee: committee ? { id: committee.id, name: committee.name } : null,
          member: { memberId: membership.id, fullName: holder(db, membership).fullName },
          changedBy: { userId: changedBy.id, fullName: changedBy.fullName },
          previousRole: change.previousRole,
          newRole: change.newRole,
          createdAt: change.createdAt,
        };
      }),
      ...pageMeta(all.length, query.page, query.pageSize),
    };
  }),
];
