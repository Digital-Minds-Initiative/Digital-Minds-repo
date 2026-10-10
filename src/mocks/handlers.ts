import { authHandlers } from '@/modules/auth/mocks';
import { membersHandlers } from '@/modules/members/mocks';
import { systemHandlers } from '@/modules/system/mocks';

/** Every module's MSW handlers. Add a module's `mocks/index.ts` handlers here. */
export const handlers = [...systemHandlers, ...authHandlers, ...membersHandlers];
