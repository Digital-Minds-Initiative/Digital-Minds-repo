import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { deletePerson } from '@/server/modules/deletions';
import { createMember } from '@/server/modules/members';
import { listRoleHistory } from '@/server/modules/permissions';
import { getMemberPoints, listPointTransactionRevisions } from '@/server/modules/points';
import { createMemberBodySchema } from '@/shared/contracts/members';
import { roleHistoryQuerySchema } from '@/shared/contracts/permissions';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { dateOnlyToDate } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectForbidden, expectInvalid, expectNotFound } from '@tests/utils/assertions';
import { auth } from '@tests/utils/auth';
import { findTextAnywhere, rowCounts, withFailingDeletionLog } from '@tests/utils/deletions';

/**
 * Deleting a person's data (ADR 0026): everything that identifies them goes, in every club; what
 * they recorded for other people stays, attributed to a deleted person; their address is free to
 * be added again. Full admins only, never their own data or another full admin's.
 */
describe("deleting a person's data", () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;

  /** The person deleted: `bothClubs`, in club A (A2) and club B (B1), with points in both. */
  let target: Scenario['users']['bothClubs'];
  let targetPublicId: string;
  const theirs = {
    /** Recorded by them for memberA2, in a batch they ran. */
    recordedForOthers: '',
    batchForOthers: crypto.randomUUID(),
    /** A batch holding only their own transaction, which the delete empties. */
    batchOfTheirs: crypto.randomUUID(),
    roleTheyGranted: '',
    exportTheyRan: '',
    invitationTheySent: '',
  };
  let adminMembership: string;
  let otherAdminMembership: string;

  const body = () => ({ uniEmail: target.uniEmail });

  beforeAll(async () => {
    s = await buildScenario();
    target = s.users.bothClubs;
    [admin, officerA, officerB, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);
    targetPublicId = (await db.user.findUniqueOrThrow({ where: { id: target.id } })).publicId;
    const { a2 } = s.committees;

    // ─ What they wrote for other people (must stay) ─
    await db.pointBatch.createMany({
      data: [
        {
          id: theirs.batchForOthers,
          clubId: s.clubA.id,
          committeeId: a2.id,
          createdById: target.id,
        },
        {
          id: theirs.batchOfTheirs,
          clubId: s.clubA.id,
          committeeId: a2.id,
          createdById: s.users.officerA.id,
        },
      ],
    });
    theirs.recordedForOthers = (
      await db.pointTransaction.create({
        data: {
          committeeMembershipId: s.committeeMemberships.memberA2,
          committeeId: a2.id,
          clubId: s.clubA.id,
          amount: 4,
          reason: 'سجّلها الشخص المحذوف',
          workDate: dateOnlyToDate(today()),
          createdById: target.id,
          batchId: theirs.batchForOthers,
        },
      })
    ).id;
    await db.pointTransactionRevision.create({
      data: {
        transactionId: s.transactions.memberA2,
        action: 'UPDATED',
        previousAmount: 15,
        previousReason: 'قبل تعديله',
        previousWorkDate: dateOnlyToDate(today()),
        previousStatus: 'ACTIVE',
        changedById: target.id,
      },
    });
    theirs.roleTheyGranted = (
      await db.roleChange.create({
        data: {
          clubId: s.clubA.id,
          committeeId: a2.id,
          membershipId: s.memberships.memberA2,
          changedById: target.id,
          previousRole: 'MEMBER',
          newRole: 'LEAD',
        },
      })
    ).id;
    theirs.invitationTheySent = (
      await db.roleInvitation.create({
        data: {
          clubId: s.clubA.id,
          committeeId: a2.id,
          membershipId: s.memberships.memberA2,
          sentById: target.id,
          sentAt: new Date(),
        },
      })
    ).id;
    theirs.exportTheyRan = (
      await db.memberExport.create({
        data: {
          clubId: s.clubA.id,
          exportedById: target.id,
          selection: 'ALL',
          filters: {},
          columns: ['fullName'],
          rowCount: 3,
        },
      })
    ).id;
    await db.membership.update({
      where: { id: s.memberships.removedOfficer },
      data: { removedById: target.id },
    });

    // ─ What is about them (must go) ─
    await db.pointTransaction.update({
      where: { id: s.transactions.bothClubsA2 },
      data: { batchId: theirs.batchOfTheirs },
    });
    await db.pointTransactionRevision.create({
      data: {
        transactionId: s.transactions.bothClubsB1,
        action: 'UPDATED',
        previousAmount: 8,
        previousReason: 'قبل تعديله',
        previousWorkDate: dateOnlyToDate(today()),
        previousStatus: 'ACTIVE',
        changedById: s.users.officerB.id,
      },
    });
    await db.roleChange.create({
      data: {
        clubId: s.clubA.id,
        committeeId: a2.id,
        membershipId: s.memberships.bothClubsA,
        changedById: s.users.officerA.id,
        previousRole: 'MEMBER',
        newRole: 'LEAD',
      },
    });
    await db.roleInvitation.create({
      data: {
        clubId: s.clubA.id,
        committeeId: a2.id,
        membershipId: s.memberships.bothClubsA,
        sentById: s.users.officerA.id,
        sentAt: new Date(),
      },
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.session.createMany({
      data: [
        { tokenHash: 'a'.repeat(64), email: target.uniEmail, userId: target.id, expiresAt },
        { tokenHash: 'b'.repeat(64), email: target.uniEmail, userId: target.id, expiresAt },
        // Half-way through signing in again: the address, no account yet.
        { tokenHash: 'c'.repeat(64), email: target.uniEmail, userId: null, expiresAt },
      ],
    });
    expect((await auth.request(target.uniEmail)).status).toBe(200);

    // Two full admins with memberships, so the member endpoint can reach them.
    adminMembership = (
      await db.membership.create({
        data: { userId: s.users.admin.id, clubId: s.clubB.id, membershipTypeId: s.types.b },
      })
    ).id;
    const otherAdmin = await db.user.create({
      data: {
        fullName: 'مسؤول عام آخر',
        searchName: normalizeForSearch('مسؤول عام آخر'),
        uniEmail: 's900000999@st.uqu.edu.sa',
        isFullAdmin: true,
        registeredAt: new Date(),
      },
    });
    otherAdminMembership = (
      await db.membership.create({
        data: { userId: otherAdmin.id, clubId: s.clubA.id, membershipTypeId: s.types.a },
      })
    ).id;
  });

  describe('refusals change nothing', () => {
    it('refuses officers who can see the person (403) and everyone else (404)', async () => {
      const before = await rowCounts();

      await expectForbidden(
        deletePerson(officerA, s.memberships.bothClubsA, body()),
        'full_admin_required',
      );
      await expectForbidden(
        deletePerson(officerB, s.memberships.bothClubsB, body()),
        'full_admin_required',
      );
      // A1's lead does not see an A2 member; a plain member sees no one.
      await expectNotFound(deletePerson(leadA1, s.memberships.bothClubsA, body()));
      await expectNotFound(deletePerson(memberA1, s.memberships.bothClubsA, body()));
      // A lead who can see a member of their committee is still refused.
      await expectForbidden(
        deletePerson(leadA1, s.memberships.memberA1, { uniEmail: s.users.memberA1.uniEmail }),
        'full_admin_required',
      );

      expect(await rowCounts()).toEqual(before);
    });

    it("refuses the admin's own data, and another full admin's", async () => {
      const before = await rowCounts();
      await expectForbidden(
        deletePerson(admin, adminMembership, { uniEmail: s.users.admin.uniEmail }),
        'cannot_delete_self',
      );
      await expectForbidden(
        deletePerson(admin, otherAdminMembership, { uniEmail: 's900000999@st.uqu.edu.sa' }),
        'cannot_delete_full_admin',
      );
      expect(await rowCounts()).toEqual(before);
    });

    it("refuses an address that is not the person's (422)", async () => {
      const before = await rowCounts();
      for (const uniEmail of [s.users.memberA2.uniEmail, `x${target.uniEmail}`, '']) {
        await expectInvalid(
          deletePerson(admin, s.memberships.bothClubsA, { uniEmail }),
          'confirmation_mismatch',
        );
      }
      expect(await rowCounts()).toEqual(before);
    });

    it('leaves everything as it was when the last step fails', async () => {
      const before = await rowCounts();
      const user = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      await expect(
        withFailingDeletionLog(() => deletePerson(admin, s.memberships.bothClubsA, body())),
      ).rejects.toThrow();
      expect(await rowCounts()).toEqual(before);
      expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(user);
    });
  });

  describe('the delete', () => {
    it('removes everything that identifies them and keeps what they recorded for others', async () => {
      const before = await rowCounts();
      // Mixed case and spaces, as an admin might type it.
      const result = await deletePerson(admin, s.memberships.bothClubsB, {
        uniEmail: ` ${target.uniEmail.toUpperCase()} `,
      });

      expect(result).toEqual({
        memberships: 2,
        committeeMemberships: 2,
        pointTransactions: 2,
        pointRevisions: 1,
        pointBatches: 1,
        roleChanges: 1,
        roleInvitations: 1,
        sessions: 3,
      });

      // Nothing anywhere in the database names them any more.
      for (const needle of [
        target.uniEmail,
        target.fullName,
        normalizeForSearch(target.fullName),
        target.phone,
        targetPublicId,
      ]) {
        expect(await findTextAnywhere(needle), needle).toEqual([]);
      }

      // The account row is the empty placeholder.
      expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        fullName: '',
        searchName: '',
        uniEmail: null,
        isFullAdmin: false,
        registeredAt: null,
        deletedAt: expect.any(Date),
      });
      expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
      expect(await db.otpChallenge.count()).toBe(0);

      // What they did for others is still there, by a deleted person.
      const points = await getMemberPoints(officerA, s.memberships.memberA2, pointsQuery());
      expect(
        points.transactions.items.find((row) => row.id === theirs.recordedForOthers)?.createdBy,
      ).toEqual({
        id: target.id,
        fullName: null,
      });
      const revisions = await listPointTransactionRevisions(officerA, s.transactions.memberA2);
      expect(revisions.items.map((row) => row.changedBy)).toEqual([
        { id: target.id, fullName: null },
      ]);
      const history = await listRoleHistory(officerA, s.clubA.id, roleHistoryQuerySchema.parse({}));
      expect(history.items.find((row) => row.id === theirs.roleTheyGranted)?.changedBy).toEqual({
        userId: target.id,
        fullName: null,
      });
      expect(await db.pointBatch.count({ where: { id: theirs.batchForOthers } })).toBe(1);
      expect(await db.pointBatch.count({ where: { id: theirs.batchOfTheirs } })).toBe(0);
      expect(await db.memberExport.count({ where: { id: theirs.exportTheyRan } })).toBe(1);
      expect(await db.roleInvitation.count({ where: { id: theirs.invitationTheySent } })).toBe(1);
      expect(
        (await db.membership.findUniqueOrThrow({ where: { id: s.memberships.removedOfficer } }))
          .removedById,
      ).toBe(target.id);

      // Other people's own points are untouched.
      for (const id of [
        s.transactions.memberA1,
        s.transactions.memberA2,
        s.transactions.memberB1,
      ]) {
        expect(await db.pointTransaction.count({ where: { id } })).toBe(1);
      }

      expect(await rowCounts()).toEqual({
        ...before,
        memberships: before.memberships - 2,
        committeeMemberships: before.committeeMemberships - 2,
        pointTransactions: before.pointTransactions - 2,
        pointRevisions: before.pointRevisions - 1,
        pointBatches: before.pointBatches - 1,
        roleChanges: before.roleChanges - 1,
        roleInvitations: before.roleInvitations - 1,
        sessions: before.sessions - 3,
        otpChallenges: before.otpChallenges - 1,
        deletionRecords: before.deletionRecords + 1,
        deletedUsers: before.deletedUsers + 1,
      });

      const records = await db.deletionRecord.findMany({ where: { kind: 'PERSON' } });
      expect(records).toEqual([
        expect.objectContaining({
          targetId: target.id,
          clubId: null,
          deletedById: s.users.admin.id,
          counts: result,
        }),
      ]);
    });

    it('can no longer be reached, and the address can be added again as a new person', async () => {
      await expectNotFound(deletePerson(admin, s.memberships.bothClubsA, body()));

      const added = await createMember(
        officerA,
        s.clubA.id,
        createMemberBodySchema.parse({
          person: { uniEmail: target.uniEmail, fullName: 'شخص جديد' },
        }),
      );
      expect(added.user).toMatchObject({ uniEmail: target.uniEmail, isRegistered: false });
      expect(added.user.id).not.toBe(target.id);
      expect(added.committees).toEqual([]);
    });
  });
});
