import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DELETE as viewLinkDelete,
  GET as viewLinkGet,
  POST as viewLinkPost,
} from '@/app/api/v1/committees/[committeeId]/view-link/route';
import { GET as memberPointsRoute } from '@/app/api/v1/public/committee-views/[token]/members/[publicId]/points/route';
import { GET as membersRoute } from '@/app/api/v1/public/committee-views/[token]/members/route';
import { GET as viewRoute } from '@/app/api/v1/public/committee-views/[token]/route';
import { db } from '@/server/db/client';
import type { defineRoute } from '@/server/http';
import { DEV_ACTOR_HEADER } from '@/shared/contracts/auth';
import { committeeViewLinkSchema } from '@/shared/contracts/clubs';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { dateOnlyToDate } from '@/shared/lib/dates';
import { buildScenario, type Scenario } from '@tests/factories/scenario';

/*
 * The view link through the real route handlers: the management endpoints behind a session, and
 * the public ones with no session at all — the first endpoints in the app anyone can reach
 * (docs/adr/0023-committee-view-link.md).
 *
 * What is checked here rather than in the service tests: the statuses, the exact JSON bodies
 * (the public ones are a whitelist), the headers a public answer must carry, and that the four
 * ways a token can fail answer with one and the same body.
 */

const APP_ORIGIN = 'http://localhost';

type Route = ReturnType<typeof defineRoute>;

interface CallOptions {
  actor?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** A session cookie is irrelevant to a public endpoint; one is sent to prove it is ignored. */
  cookie?: string;
}

function call(
  route: Route,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  { actor, params = {}, query = {}, cookie }: CallOptions = {},
): Promise<Response> {
  const url = new URL(`${APP_ORIGIN}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const request = new NextRequest(url, {
    method,
    headers: {
      ...(method === 'GET' ? {} : { origin: APP_ORIGIN }),
      ...(actor ? { [DEV_ACTOR_HEADER]: actor } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return route(request, { params: Promise.resolve(params) });
}

let s: Scenario;
let token: string;
let sara: string;

beforeAll(async () => {
  s = await buildScenario();

  const user = await db.user.create({
    data: {
      fullName: 'سارة القحطاني',
      searchName: normalizeForSearch('سارة القحطاني'),
      uniEmail: 'public.view.routes@st.uqu.edu.sa',
      registeredAt: new Date(),
    },
    select: { id: true, publicId: true },
  });
  sara = user.publicId;
  const membership = await db.membership.create({
    data: {
      userId: user.id,
      clubId: s.clubA.id,
      membershipTypeId: s.types.a,
      phone: '+966500000123',
      personalEmail: 'sara.private@example.com',
      college: 'كلية الحاسب',
      major: 'هندسة برمجيات',
      level: 6,
    },
    select: { id: true },
  });
  const committeeMembership = await db.committeeMembership.create({
    data: {
      membershipId: membership.id,
      committeeId: s.committees.a1.id,
      clubId: s.clubA.id,
    },
    select: { id: true },
  });
  await db.pointTransaction.create({
    data: {
      committeeMembershipId: committeeMembership.id,
      committeeId: s.committees.a1.id,
      clubId: s.clubA.id,
      amount: 12,
      reason: 'حضور ورشة',
      workDate: dateOnlyToDate('2026-03-01'),
      createdById: s.users.officerA.id,
    },
  });

  const response = await call(viewLinkPost, 'POST', '/api/v1/committees/x/view-link', {
    actor: s.users.officerA.uniEmail,
    params: { committeeId: s.committees.a1.id },
  });
  token = String(committeeViewLinkSchema.parse(await response.json()).token);
});

describe('the management endpoints', () => {
  const path = '/api/v1/committees/x/view-link';

  it('answers 200 with the link for an officer, a lead and a full admin', async () => {
    for (const actor of [
      s.users.officerA.uniEmail,
      s.users.leadA1.uniEmail,
      s.users.admin.uniEmail,
    ]) {
      const response = await call(viewLinkGet, 'GET', path, {
        actor,
        params: { committeeId: s.committees.a1.id },
      });
      expect(response.status).toBe(200);
      const body = committeeViewLinkSchema.parse(await response.json());
      expect(body.token).toBe(token);
      expect(body.url).toBe(`${APP_ORIGIN}/v/${token}`);
    }
  });

  it('answers exactly the three fields of the contract', async () => {
    const response = await call(viewLinkGet, 'GET', path, {
      actor: s.users.leadA1.uniEmail,
      params: { committeeId: s.committees.a1.id },
    });
    expect(Object.keys((await response.json()) as object).sort()).toEqual([
      'createdAt',
      'token',
      'url',
    ]);
  });

  it('answers 401 without a session', async () => {
    const response = await call(viewLinkGet, 'GET', path, {
      params: { committeeId: s.committees.a1.id },
    });
    expect(response.status).toBe(401);
  });

  it('answers 404 for a committee the caller cannot see', async () => {
    const response = await call(viewLinkGet, 'GET', path, {
      actor: s.users.officerB.uniEmail,
      params: { committeeId: s.committees.a1.id },
    });
    expect(response.status).toBe(404);
  });

  it('answers 422 for an id that is not a UUID', async () => {
    const response = await call(viewLinkGet, 'GET', path, {
      actor: s.users.admin.uniEmail,
      params: { committeeId: 'not-a-uuid' },
    });
    expect(response.status).toBe(422);
  });

  it('refuses a renewal from another origin (CSRF)', async () => {
    const request = new NextRequest(`${APP_ORIGIN}${path}`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', [DEV_ACTOR_HEADER]: s.users.admin.uniEmail },
    });
    const response = await viewLinkPost(request, {
      params: Promise.resolve({ committeeId: s.committees.a1.id }),
    });
    const body = (await response.json()) as ErrorEnvelope;

    expect(response.status).toBe(403);
    expect(body.error.reason).toBe('cross_origin');
  });

  it('answers 204 when the link is turned off', async () => {
    const admin = s.users.admin.uniEmail;
    const created = await call(viewLinkPost, 'POST', path, {
      actor: admin,
      params: { committeeId: s.committees.a2.id },
    });
    expect(created.status).toBe(200);

    const removed = await call(viewLinkDelete, 'DELETE', path, {
      actor: admin,
      params: { committeeId: s.committees.a2.id },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
  });
});

describe('the public endpoints', () => {
  const base = '/api/v1/public/committee-views/x';

  const header = (viewToken = token) =>
    call(viewRoute, 'GET', base, { params: { token: viewToken } });
  const search = (q: string, viewToken = token) =>
    call(membersRoute, 'GET', `${base}/members`, { params: { token: viewToken }, query: { q } });
  const points = (publicId: string, viewToken = token) =>
    call(memberPointsRoute, 'GET', `${base}/members/x/points`, {
      params: { token: viewToken, publicId },
    });

  it('work with no session at all', async () => {
    expect((await header()).status).toBe(200);
    expect((await search('سارة')).status).toBe(200);
    expect((await points(sara)).status).toBe(200);
  });

  it('ignore a session cookie if one is sent', async () => {
    const response = await call(viewRoute, 'GET', base, {
      params: { token },
      cookie: 'dm-session=whatever',
    });
    expect(response.status).toBe(200);
  });

  it('answer exactly the fields the contract whitelists — the header', async () => {
    const body = (await (await header()).json()) as Record<string, Record<string, unknown>>;
    expect(body).toEqual({ committee: { name: 'لجنة أ1' }, club: { name: 'نادي أ' } });
    expect(Object.keys(body.committee ?? {})).toEqual(['name']);
    expect(Object.keys(body.club ?? {})).toEqual(['name']);
  });

  it('answer exactly the fields the contract whitelists — the search', async () => {
    const body = (await (await search('سارة')).json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(['balance', 'fullName', 'publicId']);
    expect(body.items[0]).toEqual({ publicId: sara, fullName: 'سارة القحطاني', balance: 12 });
  });

  it('answer exactly the fields the contract whitelists — the history', async () => {
    const body = (await (await points(sara)).json()) as {
      member: Record<string, unknown>;
      transactions: { items: Array<Record<string, unknown>> };
    };
    expect(Object.keys(body).sort()).toEqual(['balance', 'member', 'transactions']);
    expect(Object.keys(body.member).sort()).toEqual(['fullName', 'publicId']);
    expect(Object.keys(body.transactions.items[0] ?? {}).sort()).toEqual([
      'amount',
      'reason',
      'workDate',
    ]);
  });

  // The stored row has a phone, a personal email, a college, a major and a level, and the member
  // has a membership id and a user id. None of it may appear anywhere in a public answer.
  it('never leak contact data, study details or internal ids', async () => {
    const bodies = await Promise.all(
      [await header(), await search('سارة'), await points(sara)].map((response) => response.text()),
    );
    for (const body of bodies) {
      for (const secret of [
        '+966500000123',
        'sara.private@example.com',
        'public.view.routes@st.uqu.edu.sa',
        'كلية الحاسب',
        'هندسة برمجيات',
        s.clubA.id,
        s.committees.a1.id,
        s.users.officerA.id,
      ]) {
        expect(body).not.toContain(secret);
      }
      expect(body).not.toMatch(/"level"|"phone"|"email"|"membershipType"|"createdBy"/);
    }
  });

  it('send no-store, no-referrer and noindex — on an answer and on a refusal', async () => {
    for (const response of [await header(), await header('Zz'.repeat(16))]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
  });

  it('answer 422 for a token that is not even the right shape', async () => {
    const response = await header('too-short');
    expect(response.status).toBe(422);
  });

  it('answer the same 404 body for every token that opens nothing', async () => {
    const admin = s.users.admin.uniEmail;

    // 1. A token no committee has.
    const unknown = await header('Zz'.repeat(16));
    // 2. A token that was renewed.
    const renewed = token;
    const after = await call(viewLinkPost, 'POST', '/api/v1/committees/x/view-link', {
      actor: admin,
      params: { committeeId: s.committees.a1.id },
    });
    const current = String(committeeViewLinkSchema.parse(await after.json()).token);
    const replaced = await header(renewed);
    // 3. A token that was turned off.
    await call(viewLinkDelete, 'DELETE', '/api/v1/committees/x/view-link', {
      actor: admin,
      params: { committeeId: s.committees.a1.id },
    });
    const disabled = await header(current);
    // 4. A token whose committee is archived.
    const link = await call(viewLinkPost, 'POST', '/api/v1/committees/x/view-link', {
      actor: admin,
      params: { committeeId: s.committees.a1.id },
    });
    const archivedToken = String(committeeViewLinkSchema.parse(await link.json()).token);
    await db.committee.update({
      where: { id: s.committees.a1.id },
      data: { archivedAt: new Date() },
    });
    const archived = await header(archivedToken);

    const bodies = [];
    for (const response of [unknown, replaced, disabled, archived]) {
      expect(response.status).toBe(404);
      const body = (await response.json()) as ErrorEnvelope;
      // The requestId is the only thing that differs between two answers of any kind.
      bodies.push({ ...body.error, requestId: 'same' });
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);

    await db.committee.update({ where: { id: s.committees.a1.id }, data: { archivedAt: null } });
  });
});
