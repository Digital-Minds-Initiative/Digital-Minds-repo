import { mockEndpoint } from '@/client/mocks/endpoint';
import { healthEndpoint } from '@/shared/contracts/system';

export const systemHandlers = [
  mockEndpoint(healthEndpoint, () => ({
    status: 'ok',
    checks: { database: 'up' },
    time: new Date().toISOString(),
  })),
];
