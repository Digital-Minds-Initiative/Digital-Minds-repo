import { beforeAll, describe, expect, it } from 'vitest';

import { POST as clubBulkRoute } from '@/app/api/v1/clubs/[clubId]/points/bulk/route';
import { POST as committeeBulkRoute } from '@/app/api/v1/committees/[committeeId]/points/bulk/route';
import { db } from '@/server/db/client';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import { pointsBulkResultSchema } from '@/shared/contracts/points';
import { actorFor, buildScenario, today, type Scenario } from '@tests/factories/scenario';
import { callRoute, type Route } from '@tests/utils/route';

/*
 * The two bulk endpoints through the real route handlers: the statuses (201 for a batch written
 * now, 200 for a replay), the 422 envelope the UI unticks rows from, and the guards every
 * non-GET route gets from defineRoute.
 */

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `0199c0e5-7777-7000-8000-${String(keys).padStart(12, '0')}`;
}

describe('the bulk-points endpoints', () => {
  let s: Scenario;

  /** The shared helper (`@tests/utils/route`); both endpoints here are POSTs. */
  function call(
    route: Route,
    path: string,
    params: Record<string, string>,
    options: { actor?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<Response> {
    return callRoute(route, { method: 'POST', path, params, ...options });
  }

  const committeeCall = (options: {
    actor?: string;
    body?: unknown;
    headers?: Record<string, string>;
    committeeId?: string;
  }) => {
    const committeeId = options.committeeId ?? s.committees.a1.id;
    return call(
      committeeBulkRoute,
      `/api/v1/committees/${committeeId}/points/bulk`,
      { committeeId },
      options,
    );
  };

  const clubCall = (options: {
    actor?: string;
    body?: unknown;
    headers?: Record<string, string>;
    clubId?: string;
  }) => {
    const clubId = options.clubId ?? s.clubA.id;
    return call(clubBulkRoute, `/api/v1/clubs/${clubId}/points/bulk`, { clubId }, options);
  };

  const committeeBody = (input: Record<string, unknown> = {}) => ({
    batchId: nextKey(),
    memberIds: [s.memberships.memberA1],
    amount: 10,
    reason: 'حضور اللقاء التعريفي',
    workDate: today(),
    ...input,
  });

  const clubBody = (input: Record<string, unknown> = {}) => ({
    batchId: nextKey(),
    entries: [{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }],
    amount: 10,
    reason: 'حضور حفل الختام',
    workDate: today(),
    ...input,
  });

  const envelope = async (response: Response) => ((await response.json()) as ErrorEnvelope).error;

  beforeAll(async () => {
    s = await buildScenario();
    await actorFor(s.users.officerA.id);
  });

  describe('the committee endpoint', () => {
    it('answers 201 with a body the contract accepts', async () => {
      const response = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: committeeBody(),
      });
      expect(response.status).toBe(201);
      const parsed = pointsBulkResultSchema.parse(await response.json());
      expect(parsed.count).toBe(1);
      expect(parsed.byCommittee).toHaveLength(1);
    });

    it('answers 200 on the second identical request', async () => {
      const body = committeeBody();
      const first = await committeeCall({ actor: s.users.leadA1.uniEmail, body });
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const second = await committeeCall({ actor: s.users.leadA1.uniEmail, body });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(firstBody);
    });

    it('answers 409 batch_mismatch for the same key with a different body', async () => {
      const body = committeeBody();
      await committeeCall({ actor: s.users.leadA1.uniEmail, body });
      const response = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: { ...body, amount: 20 },
      });
      expect(response.status).toBe(409);
      expect(await envelope(response)).toMatchObject({
        code: 'CONFLICT',
        reason: 'batch_mismatch',
      });
    });

    it('answers 422 entries_rejected, pointing at the member ids that failed', async () => {
      const before = await db.pointTransaction.count();
      const response = await committeeCall({
        actor: s.users.officerA.uniEmail,
        body: committeeBody({
          memberIds: [s.memberships.memberA1, s.memberships.memberA2],
        }),
      });
      expect(response.status).toBe(422);
      const error = await envelope(response);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', reason: 'entries_rejected' });
      expect(error.issues).toEqual([
        { path: ['body', 'memberIds', 1], code: 'not_in_committee', message: 'not_in_committee' },
      ]);
      expect(await db.pointTransaction.count()).toBe(before);
    });

    it('answers 422 for a body the contract refuses', async () => {
      const duplicate = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: committeeBody({
          memberIds: [s.memberships.memberA1, s.memberships.memberA1],
        }),
      });
      expect(duplicate.status).toBe(422);
      expect((await envelope(duplicate)).issues?.[0]?.code).toBe('duplicate_entries');

      const noKey = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: { ...committeeBody(), batchId: 'not-a-uuid' },
      });
      expect(noKey.status).toBe(422);
    });

    it('answers 404 for a committee the caller cannot see', async () => {
      const response = await committeeCall({
        actor: s.users.officerB.uniEmail,
        body: committeeBody(),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('the club endpoint', () => {
    it('answers 201 for an officer and 200 on the replay', async () => {
      const body = clubBody();
      const first = await clubCall({ actor: s.users.officerA.uniEmail, body });
      expect(first.status).toBe(201);
      const second = await clubCall({ actor: s.users.officerA.uniEmail, body });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
    });

    it('answers 403 club_management_required for a lead of one of its committees', async () => {
      const response = await clubCall({ actor: s.users.leadA1.uniEmail, body: clubBody() });
      expect(response.status).toBe(403);
      expect(await envelope(response)).toMatchObject({
        code: 'FORBIDDEN',
        reason: 'club_management_required',
      });
    });

    it('answers 404 for a lead of another club', async () => {
      const response = await clubCall({
        actor: s.users.leadA1.uniEmail,
        clubId: s.clubB.id,
        body: {
          ...clubBody(),
          entries: [{ memberId: s.memberships.memberB1, committeeId: s.committees.b1.id }],
        },
      });
      expect(response.status).toBe(404);
    });

    it('points a rejected pair at the half that is wrong', async () => {
      const response = await clubCall({
        actor: s.users.officerA.uniEmail,
        body: clubBody({
          entries: [{ memberId: s.memberships.memberA1, committeeId: s.committees.b1.id }],
        }),
      });
      expect(response.status).toBe(422);
      expect((await envelope(response)).issues).toEqual([
        { path: ['body', 'entries', 0, 'committeeId'], code: 'not_found', message: 'not_found' },
      ]);
    });
  });

  describe('the guards every write gets', () => {
    it('answers 401 without a session', async () => {
      const response = await committeeCall({ body: committeeBody() });
      expect(response.status).toBe(401);
      expect((await envelope(response)).code).toBe('UNAUTHENTICATED');
    });

    it('refuses another origin', async () => {
      const response = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: committeeBody(),
        headers: { origin: 'https://evil.example' },
      });
      expect(response.status).toBe(403);
      expect((await envelope(response)).reason).toBe('cross_origin');
    });

    it('refuses a body that is not sent as JSON', async () => {
      const response = await committeeCall({
        actor: s.users.leadA1.uniEmail,
        body: committeeBody(),
        headers: { 'content-type': 'text/plain' },
      });
      expect(response.status).toBe(400);
      expect((await envelope(response)).reason).toBe('json_required');
    });
  });
});
