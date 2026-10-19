import { beforeAll, describe, expect, it } from 'vitest';

import { POST as addPointsRoute } from '@/app/api/v1/members/[memberId]/committees/[committeeId]/points/route';
import { GET as memberPointsRoute } from '@/app/api/v1/members/[memberId]/points/route';
import { POST as cancelRoute } from '@/app/api/v1/points/[transactionId]/cancel/route';
import { GET as revisionsRoute } from '@/app/api/v1/points/[transactionId]/revisions/route';
import { PATCH as updateRoute } from '@/app/api/v1/points/[transactionId]/route';
import { db } from '@/server/db/client';
import {
  memberPointsSchema,
  pointTransactionRevisionSchema,
  pointTransactionSchema,
} from '@/shared/contracts/points';
import { actorFor, buildScenario, today, type Scenario } from '@tests/factories/scenario';
import { callRoute as call, errorOf } from '@tests/utils/route';

/*
 * The points endpoints through the real route handlers: every role against every endpoint,
 * including nobody signed in, and the bodies the contracts describe.
 */
describe('the points endpoints', () => {
  let s: Scenario;
  /** An ACTIVE transaction in committee A1, replaced before each role run that cancels it. */
  let transactionId: string;

  const endpoints = {
    memberPoints: (actor?: string) =>
      call(memberPointsRoute, {
        path: `/api/v1/members/${s.memberships.memberA1}/points`,
        params: { memberId: s.memberships.memberA1 },
        actor,
      }),
    addPoints: (actor?: string) =>
      call(addPointsRoute, {
        method: 'POST',
        path: `/api/v1/members/${s.memberships.memberA1}/committees/${s.committees.a1.id}/points`,
        params: { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
        actor,
        body: { amount: 5, reason: 'نشاط', workDate: today() },
      }),
    revisions: (actor?: string) =>
      call(revisionsRoute, {
        path: `/api/v1/points/${transactionId}/revisions`,
        params: { transactionId },
        actor,
      }),
    update: (actor?: string) =>
      call(updateRoute, {
        method: 'PATCH',
        path: `/api/v1/points/${transactionId}`,
        params: { transactionId },
        actor,
        body: { amount: 11 },
      }),
    cancel: (actor?: string) =>
      call(cancelRoute, {
        method: 'POST',
        path: `/api/v1/points/${transactionId}/cancel`,
        params: { transactionId },
        actor,
        body: { reason: 'إلغاء' },
      }),
  };

  type EndpointKey = keyof typeof endpoints;
  const endpointKeys = Object.keys(endpoints) as EndpointKey[];

  /** A fresh ACTIVE transaction, so a run that cancels one does not change the next run. */
  async function freshTransaction(): Promise<void> {
    const row = await db.pointTransaction.create({
      data: {
        committeeMembershipId: s.committeeMemberships.memberA1,
        committeeId: s.committees.a1.id,
        clubId: s.clubA.id,
        amount: 10,
        reason: 'نقاط للاختبار',
        workDate: new Date(`${today()}T00:00:00.000Z`),
        createdById: s.users.officerA.id,
      },
    });
    transactionId = row.id;
  }

  async function statuses(actor?: string): Promise<Record<EndpointKey, number>> {
    await freshTransaction();
    const result = {} as Record<EndpointKey, number>;
    for (const key of endpointKeys) {
      result[key] = (await endpoints[key](actor)).status;
    }
    return result;
  }

  beforeAll(async () => {
    s = await buildScenario();
    await actorFor(s.users.admin.id);
    await freshTransaction();
  });

  it('answer 401 with the error envelope when nobody is signed in', async () => {
    for (const key of endpointKeys) {
      const response = await endpoints[key]();
      expect(response.status, key).toBe(401);
      expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
    }
    expect(await db.pointTransaction.count({ where: { reason: 'نشاط' } })).toBe(0);
  });

  it('ignore an unregistered account', async () => {
    expect((await endpoints.memberPoints(s.users.unregistered.uniEmail)).status).toBe(401);
  });

  it('let a full admin use all five', async () => {
    await expect(statuses(s.users.admin.uniEmail)).resolves.toEqual({
      memberPoints: 200,
      addPoints: 201,
      revisions: 200,
      update: 200,
      cancel: 200,
    });
  });

  it('let an officer of the club use all five', async () => {
    await expect(statuses(s.users.officerA.uniEmail)).resolves.toEqual({
      memberPoints: 200,
      addPoints: 201,
      revisions: 200,
      update: 200,
      cancel: 200,
    });
  });

  it('let the lead of that committee use all five', async () => {
    await expect(statuses(s.users.leadA1.uniEmail)).resolves.toEqual({
      memberPoints: 200,
      addPoints: 201,
      revisions: 200,
      update: 200,
      cancel: 200,
    });
  });

  it('are a 404 for a plain member, an officer of another club, and its lead', async () => {
    const outsiders = [s.users.plain, s.users.officerB, s.users.memberB1];
    for (const person of outsiders) {
      await expect(statuses(person.uniEmail)).resolves.toEqual({
        memberPoints: 404,
        addPoints: 404,
        revisions: 404,
        update: 404,
        cancel: 404,
      });
    }
  });

  describe('bodies and errors', () => {
    beforeAll(freshTransaction);

    it('answer with exactly the contract fields', async () => {
      const added = await endpoints.addPoints(s.users.officerA.uniEmail);
      expect(added.status).toBe(201);
      const body = (await added.json()) as Record<string, unknown>;
      pointTransactionSchema.parse(body);
      expect(Object.keys(body).sort()).toEqual(Object.keys(pointTransactionSchema.shape).sort());

      const history = await endpoints.memberPoints(s.users.officerA.uniEmail);
      const page = memberPointsSchema.parse(await history.json());
      expect(page.transactions.total).toBeGreaterThan(0);
      // Active by default: a cancelled transaction is not in the list.
      expect(page.transactions.items.every((item) => item.status === 'ACTIVE')).toBe(true);

      await endpoints.update(s.users.officerA.uniEmail);
      const revisions = await endpoints.revisions(s.users.officerA.uniEmail);
      const items = itemsOf(await revisions.json());
      expect(items).toHaveLength(1);
      pointTransactionRevisionSchema.parse(items[0]);
    });

    it('refuse the member and committee in the body with a 422', async () => {
      const response = await call(addPointsRoute, {
        method: 'POST',
        path: `/api/v1/members/${s.memberships.memberA1}/committees/${s.committees.a1.id}/points`,
        params: { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
        actor: s.users.officerA.uniEmail,
        body: {
          amount: 5,
          reason: 'نشاط',
          workDate: today(),
          memberId: s.memberships.memberA2,
        },
      });
      expect(response.status).toBe(422);
      expect((await errorOf(response)).issues?.[0]?.code).toBe('unrecognized_keys');
    });

    it('refuse a zero amount and a future work date with located issues', async () => {
      for (const [body, code] of [
        [{ amount: 0, reason: 'نشاط', workDate: today() }, 'amount_zero'],
        [{ amount: 5, reason: 'نشاط', workDate: '2099-01-01' }, 'date_in_future'],
        [{ amount: 5, reason: '  ', workDate: today() }, 'too_small'],
      ] as const) {
        const response = await call(addPointsRoute, {
          method: 'POST',
          path: `/api/v1/members/${s.memberships.memberA1}/committees/${s.committees.a1.id}/points`,
          params: { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
          actor: s.users.officerA.uniEmail,
          body,
        });
        expect(response.status).toBe(422);
        const error = await errorOf(response);
        expect(error.issues?.map((issue) => issue.code)).toContain(code);
        expect(error.issues?.[0]?.path[0]).toBe('body');
      }
    });

    it('answer 409 with the reason when the member is not in the committee', async () => {
      const response = await call(addPointsRoute, {
        method: 'POST',
        path: `/api/v1/members/${s.memberships.plain}/committees/${s.committees.a1.id}/points`,
        params: { memberId: s.memberships.plain, committeeId: s.committees.a1.id },
        actor: s.users.officerA.uniEmail,
        body: { amount: 5, reason: 'نشاط', workDate: today() },
      });
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({
        code: 'CONFLICT',
        reason: 'not_in_committee',
      });
    });

    it('answer 409 when editing a cancelled transaction, and 200 when cancelling it again', async () => {
      await freshTransaction();
      expect((await endpoints.cancel(s.users.officerA.uniEmail)).status).toBe(200);
      expect((await endpoints.cancel(s.users.officerA.uniEmail)).status).toBe(200);
      const edit = await endpoints.update(s.users.officerA.uniEmail);
      expect(edit.status).toBe(409);
      expect(await errorOf(edit)).toMatchObject({ reason: 'transaction_cancelled' });
    });

    it('refuse a cross-origin write and a body that is not JSON', async () => {
      await freshTransaction();
      const crossOrigin = await call(cancelRoute, {
        method: 'POST',
        path: `/api/v1/points/${transactionId}/cancel`,
        params: { transactionId },
        actor: s.users.officerA.uniEmail,
        body: { reason: 'إلغاء' },
        origin: 'https://evil.example',
      });
      expect(crossOrigin.status).toBe(403);
      expect(await errorOf(crossOrigin)).toMatchObject({ reason: 'cross_origin' });

      const notJson = await call(cancelRoute, {
        method: 'POST',
        path: `/api/v1/points/${transactionId}/cancel`,
        params: { transactionId },
        actor: s.users.officerA.uniEmail,
        body: { reason: 'إلغاء' },
        contentType: 'text/plain',
      });
      expect(notJson.status).toBe(400);
      expect(
        await db.pointTransaction.findUniqueOrThrow({ where: { id: transactionId } }),
      ).toMatchObject({ status: 'ACTIVE' });
    });
  });
});

/** The `items` array of a revisions response, before the contract parses each one. */
function itemsOf(body: unknown): unknown[] {
  return (body as { items: unknown[] }).items;
}
