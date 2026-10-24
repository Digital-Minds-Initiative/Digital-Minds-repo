import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  createCommittee,
  getPublicCommitteeView,
  rotateCommitteeViewLink,
} from '@/server/modules/clubs';
import { deleteCommittee, getCommitteeDeletionPreview } from '@/server/modules/deletions';
import { getMemberPoints } from '@/server/modules/points';
import { dateOnlyToDate } from '@/shared/lib/dates';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  pointsQuery,
  today,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import {
  expectConflict,
  expectForbidden,
  expectInvalid,
  expectNotFound,
} from '@tests/utils/assertions';
import { rowCounts, withFailingDeletionLog } from '@tests/utils/deletions';

/**
 * Deleting a committee (ADR 0015): full admins only, after typing its name and confirming the
 * counts they were shown. It takes its committee memberships, its transactions with their
 * revisions, its lead history, its view link and any batch it empties — and nothing of the
 * people, their club memberships or their other committees.
 */
describe('deleting a committee', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;

  /** Ids of rows around A1 that tell "only the committee's rows" from "more than that". */
  const extra = {
    a1Batch: crypto.randomUUID(),
    clubBatch: crypto.randomUUID(),
    a1RevisedTransaction: '',
    a2InClubBatch: '',
    clubRoleChange: '',
  };

  async function addTransaction(
    committeeMembershipId: string,
    committee: { id: string; clubId: string },
    batchId: string | null = null,
  ) {
    const row = await db.pointTransaction.create({
      data: {
        committeeMembershipId,
        committeeId: committee.id,
        clubId: committee.clubId,
        amount: 5,
        reason: 'حضور',
        workDate: dateOnlyToDate(today()),
        createdById: s.users.officerA.id,
        batchId,
      },
    });
    return row.id;
  }

  const counts = (committeeId: string) =>
    Promise.all([
      db.committeeMembership.count({ where: { committeeId } }),
      db.pointTransaction.count({ where: { committeeId } }),
    ]).then(([committeeMemberships, pointTransactions]) => ({
      committeeMemberships,
      pointTransactions,
    }));

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerB, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);

    const { a1, a2 } = s.committees;
    // A batch only in A1, which the delete empties, and a club-wide one that keeps its A2 row.
    await db.pointBatch.createMany({
      data: [
        {
          id: extra.a1Batch,
          clubId: s.clubA.id,
          committeeId: a1.id,
          createdById: s.users.officerA.id,
        },
        {
          id: extra.clubBatch,
          clubId: s.clubA.id,
          committeeId: null,
          createdById: s.users.officerA.id,
        },
      ],
    });
    await addTransaction(s.committeeMemberships.memberA1, a1, extra.a1Batch);
    await addTransaction(s.committeeMemberships.unregisteredA1, a1, extra.clubBatch);
    extra.a2InClubBatch = await addTransaction(
      s.committeeMemberships.memberA2,
      a2,
      extra.clubBatch,
    );

    // An edited A1 transaction.
    extra.a1RevisedTransaction = await addTransaction(s.committeeMemberships.leadA1, a1);
    await db.pointTransactionRevision.create({
      data: {
        transactionId: extra.a1RevisedTransaction,
        action: 'UPDATED',
        previousAmount: 3,
        previousReason: 'قبل التعديل',
        previousWorkDate: dateOnlyToDate(today()),
        previousStatus: 'ACTIVE',
        changedById: s.users.officerA.id,
      },
    });

    // A1's lead history, and a club-level change that must survive.
    await db.roleChange.create({
      data: {
        clubId: s.clubA.id,
        committeeId: a1.id,
        membershipId: s.memberships.leadA1,
        changedById: s.users.officerA.id,
        previousRole: 'MEMBER',
        newRole: 'LEAD',
      },
    });
    extra.clubRoleChange = (
      await db.roleChange.create({
        data: {
          clubId: s.clubA.id,
          membershipId: s.memberships.officerA,
          changedById: s.users.admin.id,
          previousRole: 'MEMBER',
          newRole: 'CLUB_OFFICER',
        },
      })
    ).id;
  });

  describe('the preview', () => {
    it('counts every committee membership, removed ones too, and every transaction', async () => {
      await expect(getCommitteeDeletionPreview(admin, s.committees.a1.id)).resolves.toEqual(
        await counts(s.committees.a1.id),
      );
    });

    it("is a full admin's only", async () => {
      await expectForbidden(
        getCommitteeDeletionPreview(leadA1, s.committees.a1.id),
        'full_admin_required',
      );
      await expectNotFound(getCommitteeDeletionPreview(memberA1, s.committees.a1.id));
    });
  });

  describe('refusals change nothing', () => {
    it('refuses an officer and the lead (403) and anyone who cannot see it (404)', async () => {
      const expected = await counts(s.committees.a1.id);
      const body = { name: s.committees.a1.name, expected };
      const before = await rowCounts();

      await expectForbidden(
        deleteCommittee(officerA, s.committees.a1.id, body),
        'full_admin_required',
      );
      await expectForbidden(
        deleteCommittee(leadA1, s.committees.a1.id, body),
        'full_admin_required',
      );
      await expectNotFound(deleteCommittee(officerB, s.committees.a1.id, body));
      await expectNotFound(deleteCommittee(memberA1, s.committees.a1.id, body));

      expect(await rowCounts()).toEqual(before);
    });

    it("refuses a name that is not exactly the committee's (422)", async () => {
      const expected = await counts(s.committees.a1.id);
      const before = await rowCounts();

      for (const name of ['لجنة أ2', 'لجنة', `${s.committees.a1.name}x`, '']) {
        await expectInvalid(
          deleteCommittee(admin, s.committees.a1.id, { name, expected }),
          'confirmation_mismatch',
        );
      }
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses counts that are no longer true (409)', async () => {
      const expected = await counts(s.committees.a1.id);
      const before = await rowCounts();

      await expectConflict(
        deleteCommittee(admin, s.committees.a1.id, {
          name: s.committees.a1.name,
          expected: { ...expected, pointTransactions: expected.pointTransactions - 1 },
        }),
        'deletion_counts_changed',
      );
      expect(await rowCounts()).toEqual(before);
    });

    it('leaves everything as it was when the last step fails', async () => {
      const body = { name: s.committees.a1.name, expected: await counts(s.committees.a1.id) };
      const before = await rowCounts();

      await expect(
        withFailingDeletionLog(() => deleteCommittee(admin, s.committees.a1.id, body)),
      ).rejects.toThrow();
      expect(await rowCounts()).toEqual(before);
    });
  });

  describe('a committee with data', () => {
    it("deletes the committee's rows and only those", async () => {
      const { a1 } = s.committees;
      const view = await rotateCommitteeViewLink(admin, a1.id);
      const expected = await counts(a1.id);
      const a1Revisions = await db.pointTransactionRevision.count({
        where: { transaction: { committeeId: a1.id } },
      });
      const before = await rowCounts();
      const usersBefore = await db.user.findMany({ orderBy: { id: 'asc' } });
      const membershipsBefore = await db.membership.findMany({ orderBy: { id: 'asc' } });
      const otherCommitteeMemberships = await db.committeeMembership.findMany({
        where: { committeeId: { not: a1.id } },
        orderBy: { id: 'asc' },
      });
      const otherTransactions = await db.pointTransaction.findMany({
        where: { committeeId: { not: a1.id } },
        orderBy: { id: 'asc' },
      });
      // A member of A2 only: their points and balance must not move.
      const memberA2PointsBefore = await getMemberPoints(
        admin,
        s.memberships.memberA2,
        pointsQuery(),
      );

      const result = await deleteCommittee(admin, a1.id, { name: `  ${a1.name} `, expected });

      expect(result).toEqual({
        ...expected,
        pointRevisions: a1Revisions,
        pointBatches: 1,
        roleChanges: 1,
      });
      expect(await db.committee.count({ where: { id: a1.id } })).toBe(0);
      expect(await db.pointBatch.count({ where: { id: extra.a1Batch } })).toBe(0);
      // The club-wide batch keeps its A2 transaction, and the revision on another committee is gone
      // only with its own transaction.
      expect(await db.pointTransaction.findMany({ where: { batchId: extra.clubBatch } })).toEqual([
        expect.objectContaining({ id: extra.a2InClubBatch }),
      ]);
      expect(await db.roleChange.count({ where: { id: extra.clubRoleChange } })).toBe(1);

      // The people, their club memberships, their other committees and the other committees'
      // points are exactly as they were.
      expect(await db.user.findMany({ orderBy: { id: 'asc' } })).toEqual(usersBefore);
      expect(await db.membership.findMany({ orderBy: { id: 'asc' } })).toEqual(membershipsBefore);
      expect(await db.committeeMembership.findMany({ orderBy: { id: 'asc' } })).toEqual(
        otherCommitteeMemberships,
      );
      expect(await db.pointTransaction.findMany({ orderBy: { id: 'asc' } })).toEqual(
        otherTransactions,
      );
      expect(await getMemberPoints(admin, s.memberships.memberA2, pointsQuery())).toEqual(
        memberA2PointsBefore,
      );

      expect(await rowCounts()).toEqual({
        ...before,
        committees: before.committees - 1,
        committeeMemberships: before.committeeMemberships - expected.committeeMemberships,
        pointTransactions: before.pointTransactions - expected.pointTransactions,
        pointRevisions: before.pointRevisions - a1Revisions,
        pointBatches: before.pointBatches - 1,
        roleChanges: before.roleChanges - 1,
        deletionRecords: before.deletionRecords + 1,
      });

      // Its view link is dead, with the same 404 as any unknown token.
      await expectNotFound(getPublicCommitteeView(view.token ?? '', { ip: null }));

      const records = await db.deletionRecord.findMany({ where: { targetId: a1.id } });
      expect(records).toEqual([
        expect.objectContaining({
          kind: 'COMMITTEE',
          clubId: s.clubA.id,
          deletedById: s.users.admin.id,
          counts: result,
        }),
      ]);
    });
  });

  describe('an empty committee', () => {
    it('is deleted with zero counts', async () => {
      const committee = await createCommittee(admin, s.clubB.id, { name: 'لجنة فارغة' });
      await expect(
        deleteCommittee(admin, committee.id, {
          name: 'لجنة فارغة',
          expected: { committeeMemberships: 0, pointTransactions: 0 },
        }),
      ).resolves.toEqual({
        committeeMemberships: 0,
        pointTransactions: 0,
        pointRevisions: 0,
        pointBatches: 0,
        roleChanges: 0,
      });
      expect(await db.committee.count({ where: { id: committee.id } })).toBe(0);
    });

    it('is deleted when archived, and in an archived club', async () => {
      for (const committee of [a.archivedCommittee, a.z1]) {
        await deleteCommittee(admin, committee.id, {
          name: committee.name,
          expected: await counts(committee.id),
        });
        expect(await db.committee.count({ where: { id: committee.id } })).toBe(0);
      }
      // Their members stay in their clubs.
      expect(await db.membership.count({ where: { id: a.memberships.memberA3 } })).toBe(1);
      expect(await db.membership.count({ where: { id: a.memberships.memberZ1 } })).toBe(1);
    });
  });
});
