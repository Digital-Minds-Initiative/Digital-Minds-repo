import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { ValidationError } from '@/server/errors';
import { listMembers } from '@/server/modules/members';
import {
  addClubPointsBatch,
  addCommitteePointsBatch,
  getMemberPoints,
} from '@/server/modules/points';
import {
  CLUB_POINTS_BULK_MAX,
  clubPointsBulkBodySchema,
  memberPointsQuerySchema,
} from '@/shared/contracts/points';
import { addDays } from '@/shared/lib/dates';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  membersQuery,
  today,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/*
 * The club bulk endpoint (docs/adr/0022-bulk-points.md): pairs of (member, committee) across one
 * club, for its officers and full admins only. A lead of one of its committees is the case worth
 * the most care — they can see the club, so their refusal is a 403 rather than a 404.
 */

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `0199c0e5-2222-7000-8000-${String(keys).padStart(12, '0')}`;
}

describe('bulk points across a club', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const body = (
    entries: Array<{ memberId: string; committeeId: string }>,
    input: Record<string, unknown> = {},
  ) =>
    clubPointsBulkBodySchema.parse({
      batchId: nextKey(),
      entries,
      amount: 10,
      reason: 'حضور حفل الختام',
      workDate: today(),
      ...input,
    });

  const countAll = () => db.pointTransaction.count();

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerB, leadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  describe('who may run it', () => {
    it('an officer of that club, across its committees at once', async () => {
      const result = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([
          { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
          { memberId: s.memberships.memberA2, committeeId: s.committees.a2.id },
          { memberId: s.memberships.bothClubsA, committeeId: s.committees.a2.id },
        ]),
      );
      expect(result.replayed).toBe(false);
      expect(result.data.count).toBe(3);
      expect(result.data.byCommittee).toEqual([
        { committee: { id: s.committees.a1.id, name: s.committees.a1.name }, count: 1 },
        { committee: { id: s.committees.a2.id, name: s.committees.a2.name }, count: 2 },
      ]);
    });

    it('a full admin, in any club', async () => {
      await expect(
        addClubPointsBatch(
          admin,
          s.clubB.id,
          body([{ memberId: s.memberships.memberB1, committeeId: s.committees.b1.id }]),
        ),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });
  });

  describe('who may not', () => {
    it('a lead of one of its committees: 403, because they can see the club', async () => {
      const before = await countAll();
      await expectForbidden(
        addClubPointsBatch(
          leadA1,
          s.clubA.id,
          body([{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }]),
        ),
        'club_management_required',
      );
      expect(await countAll()).toBe(before);
    });

    it('a lead from another club: 404, because the club is not theirs to see', async () => {
      const before = await countAll();
      await expectNotFound(
        addClubPointsBatch(
          leadA1,
          s.clubB.id,
          body([{ memberId: s.memberships.memberB1, committeeId: s.committees.b1.id }]),
        ),
      );
      expect(await countAll()).toBe(before);
    });

    it('an officer of another club', async () => {
      const before = await countAll();
      await expectNotFound(
        addClubPointsBatch(
          officerB,
          s.clubA.id,
          body([{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }]),
        ),
      );
      expect(await countAll()).toBe(before);
    });

    it('a plain member of the club', async () => {
      const before = await countAll();
      await expectNotFound(
        addClubPointsBatch(
          plain,
          s.clubA.id,
          body([{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }]),
        ),
      );
      expect(await countAll()).toBe(before);
    });
  });

  describe('the pair rules', () => {
    it('gives the same member two transactions when they are picked in two committees', async () => {
      // bothClubsA is in A2 only, so use a member who really is in two committees: leadA1 is in
      // A1 (as lead) and A2 (as a plain member).
      const result = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body(
          [
            { memberId: s.memberships.leadA1, committeeId: s.committees.a1.id },
            { memberId: s.memberships.leadA1, committeeId: s.committees.a2.id },
          ],
          { amount: 25 },
        ),
      );
      expect(result.data.count).toBe(2);

      const rows = await db.pointTransaction.findMany({
        where: { batchId: result.data.batchId },
        select: { committeeId: true, amount: true },
      });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.committeeId))).toEqual(
        new Set([s.committees.a1.id, s.committees.a2.id]),
      );

      // And it counts twice in their club total — the officer's explicit choice.
      const points = await getMemberPoints(
        officerA,
        s.memberships.leadA1,
        memberPointsQuerySchema.parse({}),
      );
      const fromThisBatch = points.byCommittee.reduce(
        (total, entry) =>
          entry.committee.id === s.committees.a1.id || entry.committee.id === s.committees.a2.id
            ? total + entry.balance
            : total,
        0,
      );
      expect(fromThisBatch).toBeGreaterThanOrEqual(50);
    });

    it('refuses the same pair twice before it reaches the service', () => {
      expect(() =>
        body([
          { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
          { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
        ]),
      ).toThrow(/duplicate_entries/);
    });

    it('refuses a pair whose committee belongs to another club', async () => {
      const before = await countAll();
      const error = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([
          { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
          { memberId: s.memberships.memberA1, committeeId: s.committees.b1.id },
        ]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toEqual([
        {
          path: ['body', 'entries', 1, 'committeeId'],
          code: 'not_found',
          message: 'not_found',
        },
      ]);
      expect(await countAll()).toBe(before);
    });

    it('names committee_not_in_club when the committee is one the actor can see', async () => {
      // A full admin sees every committee, so the pair gets as far as the club comparison.
      const before = await countAll();
      const error = await addClubPointsBatch(
        admin,
        s.clubA.id,
        body([{ memberId: s.memberships.memberA1, committeeId: s.committees.b1.id }]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        {
          path: ['body', 'entries', 0, 'committeeId'],
          code: 'committee_not_in_club',
          message: 'committee_not_in_club',
        },
      ]);
      expect(await countAll()).toBe(before);
    });

    it('refuses a pair naming an archived committee, per entry', async () => {
      const before = await countAll();
      const error = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([
          { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
          { memberId: a.memberships.memberA3, committeeId: a.archivedCommittee.id },
        ]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        {
          path: ['body', 'entries', 1, 'committeeId'],
          code: 'committee_archived',
          message: 'committee_archived',
        },
      ]);
      expect(await countAll()).toBe(before);
    });

    it('refuses a member who is not in the committee of their pair', async () => {
      const before = await countAll();
      const error = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([{ memberId: s.memberships.memberA2, committeeId: s.committees.a1.id }]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        {
          path: ['body', 'entries', 0, 'memberId'],
          code: 'not_in_committee',
          message: 'not_in_committee',
        },
      ]);
      expect(await countAll()).toBe(before);
    });

    it('refuses a member of another club by the same not_found as one who does not exist', async () => {
      const error = await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([{ memberId: s.memberships.memberB1, committeeId: s.committees.a1.id }]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        { path: ['body', 'entries', 0, 'memberId'], code: 'not_found', message: 'not_found' },
      ]);
    });

    it('refuses one for a full admin too, whose scope is every club', async () => {
      // The officer above is refused by their scope alone, so this is the case that pins the
      // club filter itself: a full admin can see club B's member, and the request's club is
      // still the only one its entries may name.
      const before = await countAll();
      const error = await addClubPointsBatch(
        admin,
        s.clubA.id,
        body([{ memberId: s.memberships.memberB1, committeeId: s.committees.a1.id }]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        { path: ['body', 'entries', 0, 'memberId'], code: 'not_found', message: 'not_found' },
      ]);
      expect(await countAll()).toBe(before);
    });

    it('refuses a member of another club on the committee endpoint, for a full admin too', async () => {
      // Same gap on the other endpoint: the committee comes from the URL, so club A's committee
      // with club B's member must be not_found, not a pair that gets as far as the committee.
      const before = await countAll();
      const error = await addCommitteePointsBatch(admin, s.committees.a1.id, {
        batchId: nextKey(),
        memberIds: [s.memberships.memberB1],
        amount: 10,
        reason: 'حضور حفل الختام',
        workDate: today(),
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues).toEqual([
        { path: ['body', 'memberIds', 0], code: 'not_found', message: 'not_found' },
      ]);
      expect(await countAll()).toBe(before);
    });
  });

  describe('the limits', () => {
    it('takes a single pair', async () => {
      await expect(
        addClubPointsBatch(
          officerA,
          s.clubA.id,
          body([{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }]),
        ),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });

    it('refuses an empty list', () => {
      expect(() => body([])).toThrow();
    });

    it('takes 5000 pairs and refuses 5001', () => {
      // Written out, not derived from the constant, so the number itself is pinned.
      expect(CLUB_POINTS_BULK_MAX).toBe(5000);
      const pairs = Array.from({ length: 5001 }, (_, i) => ({
        memberId: `0199c0e5-3333-7000-8000-${String(i).padStart(12, '0')}`,
        committeeId: s.committees.a1.id,
      }));
      expect(() => body(pairs)).toThrow();
      expect(() => body(pairs.slice(0, 5000))).not.toThrow();
    });
  });

  describe('an archived club', () => {
    it('refuses the whole request', async () => {
      const officerZ = await actorFor(a.users.officerZ.id);
      const before = await countAll();
      await expectConflict(
        addClubPointsBatch(
          officerZ,
          a.archivedClub.id,
          body([{ memberId: a.memberships.memberZ1, committeeId: a.z1.id }]),
        ),
        'club_archived',
      );
      expect(await countAll()).toBe(before);
    });
  });

  describe('what the list shows afterwards', () => {
    it('counts the new points in the balance and inside a work-date period', async () => {
      const workDate = addDays(today(), -3);
      await addClubPointsBatch(
        officerA,
        s.clubA.id,
        body([{ memberId: s.memberships.memberA2, committeeId: s.committees.a2.id }], {
          amount: 60,
          workDate,
        }),
      );

      const inPeriod = await listMembers(
        officerA,
        membersQuery({ clubId: s.clubA.id, from: workDate, to: workDate, pageSize: 100 }),
      );
      const row = inPeriod.items.find((item) => item.id === s.memberships.memberA2);
      expect(inPeriod.pointsBasis).toEqual({ committee: null, from: workDate, to: workDate });
      expect(row?.points).toBe(60);

      // A period that ends before the work date leaves it out, without hiding the member.
      const before = await listMembers(
        officerA,
        membersQuery({
          clubId: s.clubA.id,
          from: addDays(workDate, -10),
          to: addDays(workDate, -1),
          pageSize: 100,
        }),
      );
      expect(before.items.find((item) => item.id === s.memberships.memberA2)?.points).toBe(0);

      // Without a period the balance includes it along with everything else.
      const allTime = await listMembers(
        officerA,
        membersQuery({ clubId: s.clubA.id, pageSize: 100 }),
      );
      expect(
        allTime.items.find((item) => item.id === s.memberships.memberA2)?.points,
      ).toBeGreaterThanOrEqual(60);
    });
  });
});
