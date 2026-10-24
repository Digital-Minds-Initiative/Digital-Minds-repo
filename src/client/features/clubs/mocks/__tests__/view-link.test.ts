import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  disableCommitteeViewLinkEndpoint,
  getCommitteeViewLinkEndpoint,
  publicCommitteeViewEndpoint,
  publicMemberPointsEndpoint,
  rotateCommitteeViewLinkEndpoint,
  searchPublicCommitteeMembersEndpoint,
  viewTokenSchema,
} from '@/shared/contracts/clubs';
import { demoKeys } from '@/shared/demo/demo';
import { demoId, demoViewToken } from '@/shared/demo/ids';

/*
 * The mock handlers for the view link, driven through the real API client — so the fixtures are
 * validated against the contracts exactly as the browser would validate them. These are what the
 * public page and the copy/renew controls are built against (docs/adr/0023-committee-view-link.md).
 */

const BASE_URL = 'http://localhost:3000';
const as = (uniEmail: string) =>
  createApiClient({
    baseUrl: BASE_URL,
    headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(uniEmail)}` },
  });

/** Demo personas (README "Seeded accounts"). */
const admin = as('s443001102@st.uqu.edu.sa');
const lead = as('s444002216@st.uqu.edu.sa');
const plainMember = as('s445001301@st.uqu.edu.sa');
const anonymous = createApiClient({ baseUrl: BASE_URL });

/** The committee the demo data gives a link to: the first of the computing club. */
const DESIGN_COMMITTEE = demoId(demoKeys.committee('computing', 'design'));
const DESIGN_TOKEN = demoViewToken(demoKeys.committee('computing', 'design'));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetMockDb();
});
afterAll(() => server.close());

describe('the management handlers', () => {
  it('answer the demo committee’s link to its lead', async () => {
    const link = await lead.request(getCommitteeViewLinkEndpoint, {
      params: { committeeId: DESIGN_COMMITTEE },
    });
    expect(link.token).toBe(DESIGN_TOKEN);
    expect(link.url).toBe(`${BASE_URL}/v/${DESIGN_TOKEN}`);
    expect(link.createdAt).not.toBeNull();
  });

  it('answer no link for a committee that has none', async () => {
    const other = demoId(demoKeys.committee('computing', 'programming'));
    await expect(
      admin.request(getCommitteeViewLinkEndpoint, { params: { committeeId: other } }),
    ).resolves.toEqual({ url: null, token: null, createdAt: null });
  });

  it('renew a link, and the old token stops opening the page', async () => {
    const renewed = await lead.request(rotateCommitteeViewLinkEndpoint, {
      params: { committeeId: DESIGN_COMMITTEE },
    });
    expect(viewTokenSchema.safeParse(renewed.token).success).toBe(true);
    expect(renewed.token).not.toBe(DESIGN_TOKEN);

    await expect(
      anonymous.request(publicCommitteeViewEndpoint, { params: { token: DESIGN_TOKEN } }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      anonymous.request(publicCommitteeViewEndpoint, { params: { token: String(renewed.token) } }),
    ).resolves.toBeDefined();
  });

  it('turn a link off', async () => {
    await lead.request(disableCommitteeViewLinkEndpoint, {
      params: { committeeId: DESIGN_COMMITTEE },
    });
    await expect(
      lead.request(getCommitteeViewLinkEndpoint, { params: { committeeId: DESIGN_COMMITTEE } }),
    ).resolves.toEqual({ url: null, token: null, createdAt: null });
    await expect(
      anonymous.request(publicCommitteeViewEndpoint, { params: { token: DESIGN_TOKEN } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('are a 404 for a member, and a 401 without a persona', async () => {
    await expect(
      plainMember.request(getCommitteeViewLinkEndpoint, {
        params: { committeeId: DESIGN_COMMITTEE },
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      anonymous.request(getCommitteeViewLinkEndpoint, {
        params: { committeeId: DESIGN_COMMITTEE },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('the public handlers', () => {
  const token = DESIGN_TOKEN;

  it('name the committee and its club', async () => {
    const view = await anonymous.request(publicCommitteeViewEndpoint, { params: { token } });
    expect(view.committee.name).toBe('لجنة التصميم');
    expect(view.club.name).toContain('نادي');
  });

  it('search the committee by name and answer balances', async () => {
    const { items } = await anonymous.request(searchPublicCommitteeMembersEndpoint, {
      params: { token },
      query: { q: 'ري' },
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'balance',
        'fullName',
        'membershipType',
        'publicId',
      ]);
      expect(Object.keys(item.membershipType)).toEqual(['name']);
      expect(item.membershipType.name).not.toBe('');
      expect(Number.isInteger(item.balance)).toBe(true);
    }
  });

  it('answer one member’s history, newest work date first', async () => {
    const { items } = await anonymous.request(searchPublicCommitteeMembersEndpoint, {
      params: { token },
      query: { q: 'ري' },
    });
    const member = items[0];
    if (!member) throw new Error('The demo committee has no members to read');

    const points = await anonymous.request(publicMemberPointsEndpoint, {
      params: { token, publicId: member.publicId },
      query: { pageSize: 5 },
    });
    expect(points.member).toEqual({
      publicId: member.publicId,
      fullName: member.fullName,
      membershipType: member.membershipType,
    });
    expect(points.balance).toBe(member.balance);
    const dates = points.transactions.items.map((item) => item.workDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('are a 404 for a token nobody has', async () => {
    await expect(
      anonymous.request(publicCommitteeViewEndpoint, { params: { token: 'Zz'.repeat(16) } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuse a search under two characters before it reaches the handler', async () => {
    await expect(
      anonymous.request(searchPublicCommitteeMembersEndpoint, {
        params: { token },
        query: { q: 'ر' },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
