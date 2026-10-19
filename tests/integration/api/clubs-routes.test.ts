import { beforeAll, describe, expect, it } from 'vitest';

import { POST as archiveClubRoute } from '@/app/api/v1/clubs/[clubId]/archive/route';
import {
  GET as listCommitteesRoute,
  POST as createCommitteeRoute,
} from '@/app/api/v1/clubs/[clubId]/committees/route';
import { PUT as reorderTypesRoute } from '@/app/api/v1/clubs/[clubId]/membership-types/order/route';
import {
  GET as listTypesRoute,
  POST as createTypeRoute,
} from '@/app/api/v1/clubs/[clubId]/membership-types/route';
import { POST as restoreClubRoute } from '@/app/api/v1/clubs/[clubId]/restore/route';
import { PATCH as updateClubRoute } from '@/app/api/v1/clubs/[clubId]/route';
import { GET as listClubsRoute, POST as createClubRoute } from '@/app/api/v1/clubs/route';
import { POST as archiveCommitteeRoute } from '@/app/api/v1/committees/[committeeId]/archive/route';
import { POST as restoreCommitteeRoute } from '@/app/api/v1/committees/[committeeId]/restore/route';
import { PATCH as updateCommitteeRoute } from '@/app/api/v1/committees/[committeeId]/route';
import {
  DELETE as deleteTypeRoute,
  PATCH as updateTypeRoute,
} from '@/app/api/v1/membership-types/[membershipTypeId]/route';
import { db } from '@/server/db/client';
import { clubSchema, committeeSchema, membershipTypeSchema } from '@/shared/contracts/clubs';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute, type Route } from '@tests/utils/route';

/*
 * The whole clubs surface through the real route handlers: who gets which status on which
 * endpoint, and that the bodies are exactly what the contracts describe.
 */

interface CallOptions {
  actor?: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/** The shared helper (`@tests/utils/route`), with the positional shape these tests read best. */
function call(
  route: Route,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  return callRoute(route, { method, path, ...options });
}

/** What one role aims each endpoint at. */
interface Target {
  clubId: string;
  clubName: string;
  committeeId: string;
  typeId: string;
  /** An unused, non-last type, so a successful DELETE has something to delete. */
  spareTypeId: string;
}

const unique = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);

/**
 * Every endpoint of the module, in an order whose side effects do not disturb each other: reads,
 * then creates, then updates, then the order, and the delete last.
 */
const endpoints = {
  listClubs: (_t: Target, actor?: string) =>
    call(listClubsRoute, 'GET', '/api/v1/clubs?includeArchived=true', { actor }),
  listCommittees: (t: Target, actor?: string) =>
    call(listCommitteesRoute, 'GET', `/api/v1/clubs/${t.clubId}/committees`, {
      actor,
      params: { clubId: t.clubId },
    }),
  listTypes: (t: Target, actor?: string) =>
    call(listTypesRoute, 'GET', `/api/v1/clubs/${t.clubId}/membership-types`, {
      actor,
      params: { clubId: t.clubId },
    }),
  createClub: (_t: Target, actor?: string) =>
    call(createClubRoute, 'POST', '/api/v1/clubs', {
      actor,
      body: { name: `نادي ${unique()}`, slug: `club-${unique()}` },
    }),
  createCommittee: (t: Target, actor?: string) =>
    call(createCommitteeRoute, 'POST', `/api/v1/clubs/${t.clubId}/committees`, {
      actor,
      params: { clubId: t.clubId },
      body: { name: `لجنة ${unique()}` },
    }),
  createType: (t: Target, actor?: string) =>
    call(createTypeRoute, 'POST', `/api/v1/clubs/${t.clubId}/membership-types`, {
      actor,
      params: { clubId: t.clubId },
      body: { name: `نوع ${unique()}` },
    }),
  updateClub: (t: Target, actor?: string) =>
    call(updateClubRoute, 'PATCH', `/api/v1/clubs/${t.clubId}`, {
      actor,
      params: { clubId: t.clubId },
      // Its own name: a successful call changes nothing.
      body: { name: t.clubName },
    }),
  updateCommittee: (t: Target, actor?: string) =>
    call(updateCommitteeRoute, 'PATCH', `/api/v1/committees/${t.committeeId}`, {
      actor,
      params: { committeeId: t.committeeId },
      body: { description: 'وصف من الاختبار' },
    }),
  updateType: (t: Target, actor?: string) =>
    call(updateTypeRoute, 'PATCH', `/api/v1/membership-types/${t.typeId}`, {
      actor,
      params: { membershipTypeId: t.typeId },
      body: { name: `نوع ${unique()}` },
    }),
  archiveCommittee: (t: Target, actor?: string) =>
    call(archiveCommitteeRoute, 'POST', `/api/v1/committees/${t.committeeId}/archive`, {
      actor,
      params: { committeeId: t.committeeId },
    }),
  restoreCommittee: (t: Target, actor?: string) =>
    call(restoreCommitteeRoute, 'POST', `/api/v1/committees/${t.committeeId}/restore`, {
      actor,
      params: { committeeId: t.committeeId },
    }),
  archiveClub: (t: Target, actor?: string) =>
    call(archiveClubRoute, 'POST', `/api/v1/clubs/${t.clubId}/archive`, {
      actor,
      params: { clubId: t.clubId },
    }),
  restoreClub: (t: Target, actor?: string) =>
    call(restoreClubRoute, 'POST', `/api/v1/clubs/${t.clubId}/restore`, {
      actor,
      params: { clubId: t.clubId },
    }),
  reorderTypes: async (t: Target, actor?: string) => {
    // Built from the club's current types, so the list is never stale.
    const rows = await db.membershipType.findMany({
      where: { clubId: t.clubId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id).reverse();
    return call(reorderTypesRoute, 'PUT', `/api/v1/clubs/${t.clubId}/membership-types/order`, {
      actor,
      params: { clubId: t.clubId },
      body: { ids: ids.length > 0 ? ids : [t.typeId] },
    });
  },
  deleteType: (t: Target, actor?: string) =>
    call(deleteTypeRoute, 'DELETE', `/api/v1/membership-types/${t.spareTypeId}`, {
      actor,
      params: { membershipTypeId: t.spareTypeId },
    }),
};

type EndpointKey = keyof typeof endpoints;
const endpointKeys = Object.keys(endpoints) as EndpointKey[];

async function statuses(target: Target, actor?: string): Promise<Record<EndpointKey, number>> {
  const result = {} as Record<EndpointKey, number>;
  for (const key of endpointKeys) {
    result[key] = (await endpoints[key](target, actor)).status;
  }
  return result;
}

const errorOf = async (response: Response) => ((await response.json()) as ErrorEnvelope).error;

describe('clubs API', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
    // Make sure the Actors exist (the dev switcher resolves them by university email).
    await Promise.all([actorFor(s.users.admin.id), actorFor(s.users.officerA.id)]);
  });

  /** Club A plus a spare type, for the roles that live in club A. */
  async function clubATarget(): Promise<Target> {
    const spare = await db.membershipType.create({
      data: { clubId: s.clubA.id, name: `نوع إضافي ${unique()}`, order: 50 },
    });
    return {
      clubId: s.clubA.id,
      clubName: s.clubA.name,
      committeeId: s.committees.a1.id,
      typeId: s.types.a2,
      spareTypeId: spare.id,
    };
  }

  describe('without a session', () => {
    it('answers 401 with the error envelope on every endpoint', async () => {
      const target = await clubATarget();
      for (const key of endpointKeys) {
        const response = await endpoints[key](target);
        expect(response.status, key).toBe(401);
        expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
      }
      // Nothing was created by any of those calls.
      expect(await db.club.count()).toBe(2);
    });

    it('ignores an unregistered account', async () => {
      const response = await endpoints.listClubs(
        await clubATarget(),
        s.users.unregistered.uniEmail,
      );
      expect(response.status).toBe(401);
    });
  });

  describe('a full admin', () => {
    it('may use every endpoint', async () => {
      const club = await db.club.create({
        data: { slug: `club-admin-${unique()}`, name: `نادي المسؤول ${unique()}` },
      });
      const committee = await db.committee.create({
        data: { clubId: club.id, name: 'لجنة المسؤول' },
      });
      const [type, spare] = await Promise.all([
        db.membershipType.create({ data: { clubId: club.id, name: 'أساسي', order: 0 } }),
        db.membershipType.create({ data: { clubId: club.id, name: 'إضافي', order: 1 } }),
      ]);

      await expect(
        statuses(
          {
            clubId: club.id,
            clubName: club.name,
            committeeId: committee.id,
            typeId: type.id,
            spareTypeId: spare.id,
          },
          s.users.admin.uniEmail,
        ),
      ).resolves.toEqual({
        listClubs: 200,
        listCommittees: 200,
        listTypes: 200,
        createClub: 201,
        createCommittee: 201,
        createType: 201,
        updateClub: 200,
        updateCommittee: 200,
        updateType: 200,
        archiveCommittee: 200,
        restoreCommittee: 200,
        archiveClub: 200,
        restoreClub: 200,
        reorderTypes: 200,
        deleteType: 204,
      });
    });
  });

  describe('a club officer', () => {
    it('manages the membership types of their club and nothing else', async () => {
      await expect(statuses(await clubATarget(), s.users.officerA.uniEmail)).resolves.toEqual({
        listClubs: 200,
        listCommittees: 200,
        listTypes: 200,
        createClub: 403,
        createCommittee: 403,
        createType: 201,
        updateClub: 403,
        updateCommittee: 403,
        updateType: 200,
        archiveCommittee: 403,
        restoreCommittee: 403,
        archiveClub: 403,
        restoreClub: 403,
        reorderTypes: 200,
        deleteType: 204,
      });
    });

    it('is a 404 on another club, not a 403', async () => {
      const target: Target = {
        clubId: s.clubB.id,
        clubName: s.clubB.name,
        committeeId: s.committees.b1.id,
        typeId: s.types.b,
        spareTypeId: s.types.b,
      };
      const result = await statuses(target, s.users.officerA.uniEmail);
      expect(result).toMatchObject({
        listCommittees: 404,
        listTypes: 404,
        createCommittee: 404,
        createType: 404,
        updateCommittee: 404,
        updateType: 404,
        reorderTypes: 404,
        deleteType: 404,
      });
      // The club-level endpoints refuse on the role first, so they stay 404 only where the club
      // itself must be found.
      expect(result.updateClub).toBe(404);
      expect(result.archiveClub).toBe(404);
      expect(await db.membershipType.count({ where: { id: s.types.b } })).toBe(1);
    });
  });

  describe('a committee lead', () => {
    it('may only read, inside their own scope', async () => {
      await expect(statuses(await clubATarget(), s.users.leadA1.uniEmail)).resolves.toEqual({
        listClubs: 200,
        listCommittees: 200,
        listTypes: 200,
        createClub: 403,
        createCommittee: 403,
        createType: 403,
        updateClub: 403,
        updateCommittee: 403,
        updateType: 403,
        archiveCommittee: 403,
        restoreCommittee: 403,
        archiveClub: 403,
        restoreClub: 403,
        reorderTypes: 403,
        deleteType: 403,
      });
    });
  });

  describe('a plain member', () => {
    it('sees no club, so everything about one is a 404', async () => {
      const result = await statuses(await clubATarget(), s.users.plain.uniEmail);
      expect(result).toEqual({
        listClubs: 200,
        listCommittees: 404,
        listTypes: 404,
        createClub: 403,
        createCommittee: 404,
        createType: 404,
        updateClub: 404,
        updateCommittee: 404,
        updateType: 404,
        archiveCommittee: 404,
        restoreCommittee: 404,
        archiveClub: 404,
        restoreClub: 404,
        reorderTypes: 404,
        deleteType: 404,
      });

      const response = await endpoints.listClubs(await clubATarget(), s.users.plain.uniEmail);
      await expect(response.json()).resolves.toEqual({ items: [] });
    });
  });

  describe('bodies and errors', () => {
    it('answers with exactly the contract fields', async () => {
      const clubs = await endpoints.listClubs(await clubATarget(), s.users.admin.uniEmail);
      const body = (await clubs.json()) as { items: Array<Record<string, unknown>> };
      for (const item of body.items) {
        clubSchema.parse(item);
        expect(Object.keys(item).sort()).toEqual(Object.keys(clubSchema.shape).sort());
      }

      const target = await clubATarget();
      const committees = await endpoints.listCommittees(target, s.users.admin.uniEmail);
      for (const item of ((await committees.json()) as { items: unknown[] }).items) {
        committeeSchema.parse(item);
      }
      const types = await endpoints.listTypes(target, s.users.admin.uniEmail);
      for (const item of ((await types.json()) as { items: unknown[] }).items) {
        membershipTypeSchema.parse(item);
      }
    });

    it('refuses a slug change with a located 422', async () => {
      const response = await call(updateClubRoute, 'PATCH', `/api/v1/clubs/${s.clubA.id}`, {
        actor: s.users.admin.uniEmail,
        params: { clubId: s.clubA.id },
        body: { name: 'اسم جديد', slug: 'new-slug' },
      });
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.issues?.[0]?.code).toBe('unrecognized_keys');
      expect(await db.club.findUnique({ where: { id: s.clubA.id } })).toMatchObject({
        slug: s.clubA.slug,
      });
    });

    it('refuses an unknown field when a club or a committee is created', async () => {
      const clubs = await db.club.count();
      const created = await call(createClubRoute, 'POST', '/api/v1/clubs', {
        actor: s.users.admin.uniEmail,
        body: { name: 'نادي جديد', slug: 'brand-new', isFullAdmin: true },
      });
      expect(created.status).toBe(422);
      expect((await errorOf(created)).issues?.[0]?.code).toBe('unrecognized_keys');
      expect(await db.club.count()).toBe(clubs);

      const committee = await call(
        createCommitteeRoute,
        'POST',
        `/api/v1/clubs/${s.clubA.id}/committees`,
        {
          actor: s.users.admin.uniEmail,
          params: { clubId: s.clubA.id },
          body: { name: 'لجنة جديدة', clubId: s.clubB.id },
        },
      );
      expect(committee.status).toBe(422);
      expect((await errorOf(committee)).issues?.[0]?.code).toBe('unrecognized_keys');
    });

    it('answers 409 with the reason for a duplicate name', async () => {
      const response = await call(createClubRoute, 'POST', '/api/v1/clubs', {
        actor: s.users.admin.uniEmail,
        body: { name: s.clubA.name, slug: `club-${unique()}` },
      });
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({ code: 'CONFLICT', reason: 'name_taken' });
    });

    it('answers 409 with the reason when a type in use has no target', async () => {
      const response = await call(
        deleteTypeRoute,
        'DELETE',
        `/api/v1/membership-types/${s.types.a}`,
        { actor: s.users.admin.uniEmail, params: { membershipTypeId: s.types.a } },
      );
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({ reason: 'membership_type_in_use' });
      expect(await db.membershipType.count({ where: { id: s.types.a } })).toBe(1);
    });

    it('moves the members when the delete names a target', async () => {
      const response = await call(
        deleteTypeRoute,
        'DELETE',
        `/api/v1/membership-types/${s.types.a}?moveMembersTo=${s.types.a2}`,
        { actor: s.users.admin.uniEmail, params: { membershipTypeId: s.types.a } },
      );
      expect(response.status).toBe(204);
      expect(await db.membershipType.count({ where: { id: s.types.a } })).toBe(0);
      expect(
        await db.membership.count({ where: { membershipTypeId: s.types.a2 } }),
      ).toBeGreaterThan(0);
    });

    it('refuses a cross-origin write and a body that is not JSON', async () => {
      const crossOrigin = await call(createClubRoute, 'POST', '/api/v1/clubs', {
        actor: s.users.admin.uniEmail,
        body: { name: `نادي ${unique()}`, slug: `club-${unique()}` },
        headers: { origin: 'https://evil.example' },
      });
      expect(crossOrigin.status).toBe(403);
      expect(await errorOf(crossOrigin)).toMatchObject({ reason: 'cross_origin' });

      const notJson = await call(createClubRoute, 'POST', '/api/v1/clubs', {
        actor: s.users.admin.uniEmail,
        body: { name: `نادي ${unique()}`, slug: `club-${unique()}` },
        headers: { 'content-type': 'text/plain' },
      });
      expect(notJson.status).toBe(400);
    });
  });
});
