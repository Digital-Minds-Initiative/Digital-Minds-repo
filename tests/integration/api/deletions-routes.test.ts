import { beforeAll, describe, expect, it } from 'vitest';

import { POST as deleteClubRoute } from '@/app/api/v1/clubs/[clubId]/delete/route';
import { GET as clubPreviewRoute } from '@/app/api/v1/clubs/[clubId]/deletion-preview/route';
import { POST as deleteCommitteeRoute } from '@/app/api/v1/committees/[committeeId]/delete/route';
import { GET as committeePreviewRoute } from '@/app/api/v1/committees/[committeeId]/deletion-preview/route';
import { POST as deletePersonRoute } from '@/app/api/v1/members/[memberId]/delete-person/route';
import { db } from '@/server/db/client';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import {
  clubDeletionCountsSchema,
  clubDeletionPreviewSchema,
  committeeDeletionCountsSchema,
  committeeDeletionPreviewSchema,
  personDeletionCountsSchema,
} from '@/shared/contracts/deletions';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute } from '@tests/utils/route';

/*
 * The delete endpoints through the real route handlers: the status each persona gets, the CSRF
 * rule, strict bodies, and responses that are exactly the contracts.
 */
describe('deletion routes', () => {
  let s: Scenario;
  let emptyClubId: string;
  let emptyCommitteeId: string;

  const errorOf = async (response: Response) => ((await response.json()) as ErrorEnvelope).error;

  beforeAll(async () => {
    s = await buildScenario();
    const club = await db.club.create({ data: { slug: 'empty-route', name: 'نادي فارغ' } });
    await db.membershipType.create({ data: { clubId: club.id, name: 'عضو', order: 0 } });
    emptyClubId = club.id;
    emptyCommitteeId = (
      await db.committee.create({ data: { clubId: s.clubB.id, name: 'لجنة فارغة' } })
    ).id;
  });

  describe('clubs', () => {
    const preview = (clubId: string, actor?: string) =>
      callRoute(clubPreviewRoute, {
        path: `/api/v1/clubs/${clubId}/deletion-preview`,
        params: { clubId },
        actor,
      });
    const remove = (clubId: string, actor?: string, origin?: string | null) =>
      callRoute(deleteClubRoute, {
        method: 'POST',
        path: `/api/v1/clubs/${clubId}/delete`,
        params: { clubId },
        actor,
        origin,
      });

    it('answers 401, 404, 403 by who asks', async () => {
      expect((await preview(s.clubA.id)).status).toBe(401);
      expect((await preview(s.clubA.id, s.users.memberA1.uniEmail)).status).toBe(404);
      const forbidden = await preview(s.clubA.id, s.users.officerA.uniEmail);
      expect(forbidden.status).toBe(403);
      expect((await errorOf(forbidden)).reason).toBe('full_admin_required');
      expect((await remove(s.clubA.id, s.users.leadA1.uniEmail)).status).toBe(403);
    });

    it('refuses a club with data with 409 club_not_empty', async () => {
      const response = await remove(s.clubA.id, s.users.admin.uniEmail);
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({ code: 'CONFLICT', reason: 'club_not_empty' });
    });

    it('refuses a request from another origin', async () => {
      const response = await remove(emptyClubId, s.users.admin.uniEmail, null);
      expect(response.status).toBe(403);
      expect(await db.club.count({ where: { id: emptyClubId } })).toBe(1);
    });

    it('previews and deletes an empty club for a full admin', async () => {
      const shown = await preview(emptyClubId, s.users.admin.uniEmail);
      expect(clubDeletionPreviewSchema.strict().parse(await shown.json())).toMatchObject({
        deletable: true,
      });
      const response = await remove(emptyClubId, s.users.admin.uniEmail);
      expect(response.status).toBe(200);
      expect(clubDeletionCountsSchema.strict().parse(await response.json())).toEqual({
        committees: 0,
        membershipTypes: 1,
        memberExports: 0,
        pointBatches: 0,
      });
    });
  });

  describe('committees', () => {
    const remove = (committeeId: string, body: unknown, actor = s.users.admin.uniEmail) =>
      callRoute(deleteCommitteeRoute, {
        method: 'POST',
        path: `/api/v1/committees/${committeeId}/delete`,
        params: { committeeId },
        actor,
        body,
      });

    it('previews the counts for a full admin only', async () => {
      const path = `/api/v1/committees/${s.committees.a1.id}/deletion-preview`;
      const params = { committeeId: s.committees.a1.id };
      expect(
        (await callRoute(committeePreviewRoute, { path, params, actor: s.users.leadA1.uniEmail }))
          .status,
      ).toBe(403);
      const response = await callRoute(committeePreviewRoute, {
        path,
        params,
        actor: s.users.admin.uniEmail,
      });
      expect(committeeDeletionPreviewSchema.strict().parse(await response.json())).toEqual({
        committeeMemberships: await db.committeeMembership.count({
          where: { committeeId: s.committees.a1.id },
        }),
        pointTransactions: await db.pointTransaction.count({
          where: { committeeId: s.committees.a1.id },
        }),
      });
    });

    it('answers 422 for a wrong name or an unknown field, 409 for stale counts', async () => {
      const expected = { committeeMemberships: 0, pointTransactions: 0 };
      const wrongName = await remove(emptyCommitteeId, { name: 'لجنة أخرى', expected });
      expect(wrongName.status).toBe(422);
      expect((await errorOf(wrongName)).issues).toEqual([
        expect.objectContaining({ path: ['body', 'name'], code: 'confirmation_mismatch' }),
      ]);
      expect(
        (await remove(emptyCommitteeId, { name: 'لجنة فارغة', expected, force: true })).status,
      ).toBe(422);
      const stale = await remove(emptyCommitteeId, {
        name: 'لجنة فارغة',
        expected: { committeeMemberships: 1, pointTransactions: 0 },
      });
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).reason).toBe('deletion_counts_changed');
      expect(await db.committee.count({ where: { id: emptyCommitteeId } })).toBe(1);
    });

    it('deletes for a full admin', async () => {
      const response = await remove(emptyCommitteeId, {
        name: 'لجنة فارغة',
        expected: { committeeMemberships: 0, pointTransactions: 0 },
      });
      expect(response.status).toBe(200);
      expect(committeeDeletionCountsSchema.strict().parse(await response.json())).toMatchObject({
        committeeMemberships: 0,
      });
    });
  });

  describe('people', () => {
    const remove = (memberId: string, uniEmail: string, actor?: string) =>
      callRoute(deletePersonRoute, {
        method: 'POST',
        path: `/api/v1/members/${memberId}/delete-person`,
        params: { memberId },
        actor,
        body: { uniEmail },
      });

    it('answers 401, 404 and 403 by who asks, and 422 for the wrong address', async () => {
      const { plain } = s.memberships;
      const email = s.users.plain.uniEmail;
      expect((await remove(plain, email)).status).toBe(401);
      expect((await remove(plain, email, s.users.officerB.uniEmail)).status).toBe(404);
      const forbidden = await remove(plain, email, s.users.officerA.uniEmail);
      expect(forbidden.status).toBe(403);
      expect((await errorOf(forbidden)).reason).toBe('full_admin_required');
      const mismatch = await remove(plain, s.users.memberA1.uniEmail, s.users.admin.uniEmail);
      expect(mismatch.status).toBe(422);
      expect(await db.membership.count({ where: { id: plain } })).toBe(1);
    });

    it('deletes for a full admin', async () => {
      const response = await remove(
        s.memberships.plain,
        s.users.plain.uniEmail,
        s.users.admin.uniEmail,
      );
      expect(response.status).toBe(200);
      expect(personDeletionCountsSchema.strict().parse(await response.json())).toMatchObject({
        memberships: 1,
      });
    });
  });
});
