import { canSeeMembership, findMockActor, getMockDb } from '@/client/mocks/db';
import { mockEndpoint, mockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { getMemberEndpoint, listMembersEndpoint } from '@/shared/contracts/members';

import { listMemberFixtures, toMemberFixture } from './fixtures';
import { memberWriteHandlers } from './writes';

export { listMemberFixtures, toMemberFixture } from './fixtures';

export const membersHandlers = [
  mockEndpoint(listMembersEndpoint, ({ cookies, query }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
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
];
