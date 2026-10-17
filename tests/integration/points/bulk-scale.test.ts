import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { addClubPointsBatch, addCommitteePointsBatch } from '@/server/modules/points';
import {
  CLUB_POINTS_BULK_MAX,
  COMMITTEE_POINTS_BULK_MAX,
  clubPointsBulkBodySchema,
  committeePointsBulkBodySchema,
} from '@/shared/contracts/points';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { actorFor, buildScenario, today, type Scenario } from '@tests/factories/scenario';

/*
 * The biggest request either endpoint accepts, against the real database: that it fits under the
 * 2 MB body cap, that one transaction is enough for it, and what it costs.
 *
 * Prisma's query compiler splits a createMany past ~32,766 bind values into several statements by
 * itself (the limit the pg adapter reports, or that default for postgres), so 5000 rows of ~11
 * columns go in as a handful of INSERTs — inside one transaction, which is what keeps the batch
 * all-or-nothing. Nothing here chunks by hand.
 */

const CLUB_COMMITTEES = 5;

describe('the largest batches', () => {
  let s: Scenario;
  let officerA: Actor;
  let leadA1: Actor;
  /** Memberships of club A, in A1, for the committee endpoint. */
  let inA1: string[];
  /** (member, committee) pairs spread over several committees of club A. */
  let pairs: Array<{ memberId: string; committeeId: string }>;

  beforeAll(async () => {
    s = await buildScenario();
    [officerA, leadA1] = await Promise.all([
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
    ]);

    // Extra committees so the club batch really spans several of them.
    const committees = [
      s.committees.a1.id,
      ...(
        await db.committee.createManyAndReturn({
          data: Array.from({ length: CLUB_COMMITTEES - 1 }, (_, index) => ({
            clubId: s.clubA.id,
            name: `لجنة الحجم ${index + 1}`,
          })),
          select: { id: true },
        })
      ).map((row) => row.id),
    ];

    // One person per pair, so no pair is a duplicate: CLUB_POINTS_BULK_MAX members, each in one
    // committee, plus enough of them in A1 for the committee endpoint's limit.
    const users = await db.user.createManyAndReturn({
      data: Array.from({ length: CLUB_POINTS_BULK_MAX }, (_, index) => {
        const fullName = `عضو الحجم ${index}`;
        return {
          fullName,
          searchName: normalizeForSearch(fullName),
          uniEmail: `s77${String(index).padStart(7, '0')}@st.uqu.edu.sa`,
          registeredAt: new Date(),
        };
      }),
      select: { id: true },
    });
    const memberships = await db.membership.createManyAndReturn({
      data: users.map((user) => ({
        userId: user.id,
        clubId: s.clubA.id,
        membershipTypeId: s.types.a,
      })),
      select: { id: true },
    });
    const links = memberships.map((membership, index) => ({
      membershipId: membership.id,
      // The first COMMITTEE_POINTS_BULK_MAX go into A1; the rest spread over the others.
      committeeId:
        index < COMMITTEE_POINTS_BULK_MAX
          ? s.committees.a1.id
          : (committees[index % CLUB_COMMITTEES] ?? s.committees.a1.id),
      clubId: s.clubA.id,
    }));
    await db.committeeMembership.createMany({ data: links });

    inA1 = links
      .filter((link) => link.committeeId === s.committees.a1.id)
      .slice(0, COMMITTEE_POINTS_BULK_MAX)
      .map((link) => link.membershipId);
    pairs = links.map((link) => ({
      memberId: link.membershipId,
      committeeId: link.committeeId,
    }));
  }, 120_000);

  it(`takes ${COMMITTEE_POINTS_BULK_MAX} members on the committee endpoint`, async () => {
    const body = committeePointsBulkBodySchema.parse({
      batchId: '0199c0e5-5555-7000-8000-000000000001',
      memberIds: inA1,
      amount: 10,
      reason: 'حضور اللقاء التعريفي',
      workDate: today(),
    });
    expect(inA1).toHaveLength(COMMITTEE_POINTS_BULK_MAX);
    const bytes = Buffer.byteLength(JSON.stringify(body));

    const started = Date.now();
    const result = await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
    const elapsed = Date.now() - started;

    expect(result.data.count).toBe(COMMITTEE_POINTS_BULK_MAX);
    expect(result.data.transactionIds).toHaveLength(COMMITTEE_POINTS_BULK_MAX);
    expect(await db.pointTransaction.count({ where: { batchId: body.batchId } })).toBe(
      COMMITTEE_POINTS_BULK_MAX,
    );
    // Well under the 2 MB cap in src/server/http/route.ts.
    expect(bytes).toBeLessThan(2_000_000);
    console.log(
      `committee bulk: ${COMMITTEE_POINTS_BULK_MAX} members, ${bytes} request bytes, ${elapsed}ms`,
    );
  }, 60_000);

  it(`takes ${CLUB_POINTS_BULK_MAX} pairs on the club endpoint, in one transaction`, async () => {
    const body = clubPointsBulkBodySchema.parse({
      batchId: '0199c0e5-5555-7000-8000-000000000002',
      entries: pairs,
      amount: 10,
      reason: 'حضور حفل الختام السنوي للنادي',
      workDate: today(),
    });
    expect(pairs).toHaveLength(CLUB_POINTS_BULK_MAX);
    const bytes = Buffer.byteLength(JSON.stringify(body));

    const started = Date.now();
    const result = await addClubPointsBatch(officerA, s.clubA.id, body);
    const elapsed = Date.now() - started;

    expect(result.data.count).toBe(CLUB_POINTS_BULK_MAX);
    expect(result.data.byCommittee.reduce((total, entry) => total + entry.count, 0)).toBe(
      CLUB_POINTS_BULK_MAX,
    );
    expect(await db.pointTransaction.count({ where: { batchId: body.batchId } })).toBe(
      CLUB_POINTS_BULK_MAX,
    );
    expect(bytes).toBeLessThan(2_000_000);
    console.log(`club bulk: ${CLUB_POINTS_BULK_MAX} pairs, ${bytes} request bytes, ${elapsed}ms`);

    // The replay of a batch that size must not rewrite any of it.
    const replayStarted = Date.now();
    const replay = await addClubPointsBatch(officerA, s.clubA.id, body);
    console.log(`club bulk replay: ${Date.now() - replayStarted}ms`);
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(result.data);
    expect(await db.pointTransaction.count({ where: { batchId: body.batchId } })).toBe(
      CLUB_POINTS_BULK_MAX,
    );
  }, 120_000);

  it('rolls the whole thing back when one of thousands of pairs is unusable', async () => {
    const before = await db.pointTransaction.count();
    const body = clubPointsBulkBodySchema.parse({
      batchId: '0199c0e5-5555-7000-8000-000000000003',
      entries: [
        ...pairs.slice(0, CLUB_POINTS_BULK_MAX - 1),
        // In the club, but not in that committee.
        { memberId: s.memberships.plain, committeeId: s.committees.a1.id },
      ],
      amount: 10,
      reason: 'حضور حفل الختام السنوي للنادي',
      workDate: today(),
    });

    await expect(addClubPointsBatch(officerA, s.clubA.id, body)).rejects.toThrow();
    expect(await db.pointTransaction.count()).toBe(before);
    expect(await db.pointBatch.findUnique({ where: { id: body.batchId } })).toBeNull();
  }, 120_000);
});
