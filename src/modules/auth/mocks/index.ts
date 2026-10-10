import { findMockActor, getMockDb } from '@/mocks/db';
import { mockEndpoint, mockError } from '@/mocks/endpoint';

import { DEV_ACTOR_COOKIE, meEndpoint } from '../contracts';
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
