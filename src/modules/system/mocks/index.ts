import { mockEndpoint } from '@/mocks/endpoint';

import { healthEndpoint } from '../contracts';

export const systemHandlers = [
  mockEndpoint(healthEndpoint, () => ({
    status: 'ok',
    checks: { database: 'up' },
    time: new Date().toISOString(),
  })),
];
