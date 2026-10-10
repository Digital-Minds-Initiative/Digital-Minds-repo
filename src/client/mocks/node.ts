import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/** Node mocking for unit tests (hooks, components, the API client). */
export const server = setupServer(...handlers);
