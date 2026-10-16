import { authHandlers } from '@/client/features/auth/mocks';
import { membersHandlers } from '@/client/features/members/mocks';
import { pointsHandlers } from '@/client/features/points/mocks';
import { systemHandlers } from '@/client/features/system/mocks';

/** Every module's MSW handlers. Add a module's `mocks/index.ts` handlers here. */
export const handlers = [...systemHandlers, ...authHandlers, ...membersHandlers, ...pointsHandlers];
