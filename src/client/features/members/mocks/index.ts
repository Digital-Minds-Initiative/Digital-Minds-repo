import {
  canSeeCommittee,
  canSeeMembership,
  findMockActor,
  getMockDb,
  type MockActor,
  type MockDb,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  getMemberEndpoint,
  listMembersEndpoint,
  type ListMembersQuery,
} from '@/shared/contracts/members';

import { listMemberFixtures, toMemberFixture } from './fixtures';
import { memberImportHandlers } from './import';
import { memberWriteHandlers } from './writes';

/** The error the server would answer with for an unreachable or contradictory filter, or null. */
function checkFilters(db: MockDb, actor: MockActor, query: ListMembersQuery): MockError | null {
  const club = query.clubId === undefined ? null : db.clubsById.get(query.clubId);
  if (query.clubId !== undefined && (!club || !canSeeClub(db, actor, query.clubId))) {
    return mockError('NOT_FOUND');
  }
  const committee =
    query.committeeId === undefined ? null : db.committeesById.get(query.committeeId);
  if (
    query.committeeId !== undefined &&
    (!committee || !canSeeCommittee(actor, committee.clubId, committee.id))
  ) {
    return mockError('NOT_FOUND');
  }
  const types = (query.membershipTypeId ?? []).map((id) => db.membershipTypesById.get(id));
  if (types.some((type) => !type || !canSeeClub(db, actor, type.clubId))) {
    return mockError('NOT_FOUND');
  }

  // One club rules the request; everything else must agree with it.
  const clubId = club?.id ?? committee?.clubId ?? types[0]?.clubId ?? null;
  if (committee && committee.clubId !== clubId) {
    return mockError('VALIDATION_FAILED', 'committee_not_in_club', {
      issues: [
        {
          path: ['query', 'committeeId'],
          code: 'committee_not_in_club',
          message: 'The committee belongs to another club.',
        },
      ],
    });
  }
  if (types.some((type) => type && type.clubId !== clubId)) {
    return mockError('VALIDATION_FAILED', 'membership_type_not_in_club', {
      issues: [
        {
          path: ['query', 'membershipTypeId'],
          code: 'membership_type_not_in_club',
          message: 'The membership type belongs to another club.',
        },
      ],
    });
  }
  return null;
}

/** A persona sees a club when they manage it or lead one of its committees. */
function canSeeClub(db: MockDb, actor: MockActor, clubId: string): boolean {
  return (
    actor.user.isFullAdmin ||
    actor.officerClubIds.includes(clubId) ||
    db.committees.some(
      (committee) => committee.clubId === clubId && actor.ledCommitteeIds.includes(committee.id),
    )
  );
}

export { listMemberFixtures, toMemberFixture } from './fixtures';

export const membersHandlers = [
  mockEndpoint(listMembersEndpoint, ({ cookies, query }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    // Same rule as the server: a filter may only narrow what the persona already sees, so one
    // they cannot see is a 404 and one from another club is a 422.
    const invalidFilter = checkFilters(db, actor, query);
    if (invalidFilter) return invalidFilter;
    return listMemberFixtures(db, actor, query);
  }),

  mockEndpoint(getMemberEndpoint, ({ cookies, params }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((m) => m.id === params.memberId);
    // Same rule as the server: outside your scope looks exactly like "does not exist".
    if (!membership || !canSeeMembership(actor, membership)) return mockError('NOT_FOUND');
    return toMemberFixture(db, actor, membership);
  }),

  ...memberWriteHandlers,
  ...memberImportHandlers,
];
