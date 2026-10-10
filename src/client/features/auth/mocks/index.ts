import { findMockActor, getMockDb } from '@/client/mocks/db';
import { mockEndpoint, mockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE, meEndpoint } from '@/shared/contracts/auth';

import { buildMeFixture } from './fixtures';

export { buildMeFixture } from './fixtures';

export const authHandlers = [
  mockEndpoint(meEndpoint, ({ cookies }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    return buildMeFixture(db, actor);
  }),
];
