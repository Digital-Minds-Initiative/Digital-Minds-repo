import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { DEV_ACTOR_COOKIE, meEndpoint } from '@/modules/auth/contracts';
import { listMembersEndpoint } from '@/modules/members/contracts';

import { ApiError, createApiClient } from './api-client';

const BASE_URL = 'http://localhost:3000';
const asOfficer = createApiClient({
  baseUrl: BASE_URL,
  headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent('s443001102@st.uqu.edu.sa')}` },
});
const anonymous = createApiClient({ baseUrl: BASE_URL });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('api client (against the MSW mocks)', () => {
  it('returns contract-validated data', async () => {
    const me = await asOfficer.request(meEndpoint, {});
    expect(me.user.uniEmail).toBe('s443001102@st.uqu.edu.sa');

    const page = await asOfficer.request(listMembersEndpoint, {
      query: { pageSize: 5, sort: 'joinedAt', order: 'desc' },
    });
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.page).toBe(1);
  });

  it('turns the error envelope into an ApiError', async () => {
    await expect(anonymous.request(meEndpoint, {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('surfaces validation errors with their issues', async () => {
    const error = await asOfficer
      // Deliberately invalid: the contract caps pageSize at 100.
      .request(listMembersEndpoint, { query: { pageSize: 500 } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_FAILED');
    expect((error as ApiError).details.issues?.[0]?.path).toEqual(['query', 'pageSize']);
  });

  it('reports network failures as NETWORK', async () => {
    const offline = createApiClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(offline.request(meEndpoint, {})).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
  });
});
