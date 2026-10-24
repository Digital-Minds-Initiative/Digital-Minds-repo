import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  archiveClub,
  createClub,
  createCommittee,
  createMembershipType,
} from '@/server/modules/clubs';
import { deleteClub, getClubDeletionPreview } from '@/server/modules/deletions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';
import { rowCounts, withFailingDeletionLog } from '@tests/utils/deletions';

/**
 * Deleting a club (ADR 0015): full admins only, and only a club that never had a member or a
 * point. It goes with its committees, its membership types and its export log, in one
 * transaction, and leaves one deletion record.
 */
describe('deleting a club', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;

  const unique = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10);

  /** A club as a full admin creates it, with a second type and two committees. */
  async function emptyClub() {
    const club = await createClub(admin, {
      name: `نادي فارغ ${unique()}`,
      slug: `empty-${unique()}`,
    });
    await createMembershipType(admin, club.id, { name: 'عضو فعال' });
    await createCommittee(admin, club.id, { name: 'لجنة 1' });
    await createCommittee(admin, club.id, { name: 'لجنة 2' });
    return club;
  }

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);
  });

  describe('the preview', () => {
    it('counts an empty club as deletable', async () => {
      const club = await emptyClub();
      await expect(getClubDeletionPreview(admin, club.id)).resolves.toEqual({
        deletable: true,
        memberships: 0,
        pointTransactions: 0,
        committees: 2,
        membershipTypes: 2,
      });
    });

    it('counts a club with members and points as not deletable', async () => {
      const preview = await getClubDeletionPreview(admin, s.clubA.id);
      expect(preview).toMatchObject({ deletable: false });
      expect(preview.memberships).toBe(
        await db.membership.count({ where: { clubId: s.clubA.id } }),
      );
      expect(preview.pointTransactions).toBe(
        await db.pointTransaction.count({ where: { clubId: s.clubA.id } }),
      );
    });

    it("is a full admin's only", async () => {
      await expectForbidden(getClubDeletionPreview(officerA, s.clubA.id), 'full_admin_required');
      await expectNotFound(getClubDeletionPreview(memberA1, s.clubA.id));
    });
  });

  describe('who may delete', () => {
    it('refuses an officer and a lead of the club (403) and anyone who cannot see it (404)', async () => {
      const club = await emptyClub();
      const before = await rowCounts();

      await expectForbidden(deleteClub(officerA, s.clubA.id), 'full_admin_required');
      await expectForbidden(deleteClub(leadA1, s.clubA.id), 'full_admin_required');
      await expectNotFound(deleteClub(memberA1, s.clubA.id));
      // An officer of another club cannot see the empty club at all.
      await expectNotFound(deleteClub(officerB, club.id));
      await expectNotFound(deleteClub(officerA, club.id));

      expect(await rowCounts()).toEqual(before);
    });
  });

  describe('what may be deleted', () => {
    it('refuses a club with members and points, and changes nothing', async () => {
      const before = await rowCounts();
      await expectConflict(deleteClub(admin, s.clubA.id), 'club_not_empty');
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses a club whose only membership was removed', async () => {
      const club = await emptyClub();
      const type = await db.membershipType.findFirstOrThrow({ where: { clubId: club.id } });
      await db.membership.create({
        data: {
          userId: s.users.plain.id,
          clubId: club.id,
          membershipTypeId: type.id,
          removedAt: new Date(),
        },
      });
      const before = await rowCounts();

      await expectConflict(deleteClub(admin, club.id), 'club_not_empty');
      expect(await rowCounts()).toEqual(before);
    });

    it('deletes an empty club with its committees, types and export log, and nothing else', async () => {
      const club = await emptyClub();
      await db.memberExport.create({
        data: {
          clubId: club.id,
          exportedById: s.users.admin.id,
          selection: 'ALL',
          filters: {},
          columns: ['fullName'],
          rowCount: 0,
        },
      });
      const before = await rowCounts();

      await expect(deleteClub(admin, club.id)).resolves.toEqual({
        committees: 2,
        membershipTypes: 2,
        memberExports: 1,
        pointBatches: 0,
      });

      expect(await db.club.count({ where: { id: club.id } })).toBe(0);
      expect(await db.committee.count({ where: { clubId: club.id } })).toBe(0);
      expect(await db.membershipType.count({ where: { clubId: club.id } })).toBe(0);
      expect(await rowCounts()).toEqual({
        ...before,
        clubs: before.clubs - 1,
        committees: before.committees - 2,
        membershipTypes: before.membershipTypes - 2,
        memberExports: before.memberExports - 1,
        deletionRecords: before.deletionRecords + 1,
      });
    });

    it('deletes an archived empty club', async () => {
      const club = await emptyClub();
      await archiveClub(admin, club.id);
      await deleteClub(admin, club.id);
      expect(await db.club.count({ where: { id: club.id } })).toBe(0);
    });

    it('answers 404 for a club that is already gone', async () => {
      const club = await emptyClub();
      await deleteClub(admin, club.id);
      await expectNotFound(deleteClub(admin, club.id));
    });
  });

  describe('the record', () => {
    it('writes one row with the ids and counts, and nothing else', async () => {
      const club = await emptyClub();
      const counts = await deleteClub(admin, club.id);

      const records = await db.deletionRecord.findMany({ where: { targetId: club.id } });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        kind: 'CLUB',
        clubId: null,
        deletedById: s.users.admin.id,
        counts,
      });
      expect(JSON.stringify(records[0]?.counts)).not.toContain(club.name);
    });
  });

  describe('one transaction', () => {
    it('leaves everything as it was when the last step fails', async () => {
      const club = await emptyClub();
      const before = await rowCounts();

      await expect(withFailingDeletionLog(() => deleteClub(admin, club.id))).rejects.toThrow();
      expect(await rowCounts()).toEqual(before);
      expect(await db.club.count({ where: { id: club.id } })).toBe(1);
    });
  });
});
