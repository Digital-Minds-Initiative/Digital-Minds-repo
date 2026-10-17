import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  confirmMemberImport,
  createMember,
  previewMemberImport,
  removeMember,
} from '@/server/modules/members';
import { getMemberPoints } from '@/server/modules/points';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  pointsQuery,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict } from '@tests/utils/assertions';
import { importFile, importFixture } from '@tests/utils/import-file';

/*
 * The import itself (docs/adr/0021-csv-member-import.md): one transaction, only the rows the
 * preview said it would write, and nothing at all when anything has changed since.
 */
describe('importing a members CSV', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let officerA: Actor;
  let admin: Actor;

  const world = async () => ({
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    memberships: await db.membership.findMany({ orderBy: { id: 'asc' } }),
    committeeMemberships: await db.committeeMembership.findMany({ orderBy: { id: 'asc' } }),
    points: await db.pointTransaction.findMany({ orderBy: { id: 'asc' } }),
  });

  /** Preview, then import exactly what the preview described. */
  const importFully = async (actor: Actor, file: string, clubId = s.clubA.id) => {
    const preview = await previewMemberImport(actor, clubId, { file });
    return confirmMemberImport(actor, clubId, { file, checksum: preview.checksum });
  };

  const csv = (...lines: string[]) =>
    importFile(
      ['الاسم الكامل,البريد الجامعي,رقم الجوال,الكلية,المستوى,نوع العضوية,اللجان', ...lines].join(
        '\n',
      ),
    );

  const memberByEmail = (uniEmail: string) =>
    db.membership.findFirstOrThrow({
      where: { clubId: s.clubA.id, user: { uniEmail } },
      include: {
        user: true,
        membershipType: true,
        committeeMemberships: { include: { committee: true } },
      },
    });

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [officerA, admin] = await Promise.all([
      actorFor(s.users.officerA.id),
      actorFor(s.users.admin.id),
    ]);
  });

  describe('what it writes', () => {
    it('creates the people, their memberships and their committees', async () => {
      const result = await importFully(officerA, importFixture('arabic-headers.csv'));
      expect(result).toEqual({ added: 3, restored: 0, skippedExisting: 0, skippedInvalid: 0 });

      const first = await memberByEmail('s441000101@uqu.edu.sa');
      expect(first).toMatchObject({
        clubId: s.clubA.id,
        role: 'MEMBER',
        removedAt: null,
        phone: '+966551110001',
        personalEmail: 'ahmed@gmail.com',
        college: 'كلية الحاسبات',
        major: 'علوم حاسب',
        level: 4,
      });
      expect(first.user).toMatchObject({
        fullName: 'أحمد علي الزهراني',
        uniEmail: 's441000101@uqu.edu.sa',
        // Nobody is told they were imported; they register themselves (ADR 0014).
        registeredAt: null,
        searchName: 'احمد علي الزهراني',
      });
      expect(first.membershipType.name).toBe('عضو فعال');
      expect(first.committeeMemberships.map((row) => row.committee.name)).toEqual(['لجنة أ1']);

      // Arabic-Indic digits, two committees, and the club's first type by default.
      const second = await memberByEmail('s441000102@uqu.edu.sa');
      expect(second).toMatchObject({ phone: '+966551110002', level: 2 });
      expect(second.membershipType.name).toBe('عضو');
      expect(second.committeeMemberships.map((row) => row.committee.name).sort()).toEqual([
        'لجنة أ1',
        'لجنة أ2',
      ]);

      const third = await memberByEmail('s441000103@uqu.edu.sa');
      expect(third).toMatchObject({ phone: null, college: null, level: null });
      expect(third.committeeMemberships).toEqual([]);
    });

    it('links an account that already exists in another club, keeping its own name', async () => {
      const before = await db.user.count();
      const result = await importFully(
        officerA,
        csv(`اسم مختلف تماما,${s.users.memberB1.uniEmail},0551119999,,,,`),
      );

      expect(result).toMatchObject({ added: 1 });
      expect(await db.user.count()).toBe(before);
      const member = await memberByEmail(s.users.memberB1.uniEmail);
      // One account per person: the membership is new, the name on it is not the file's.
      expect(member.user.fullName).toBe(s.users.memberB1.fullName);
      expect(member.phone).toBe('+966551119999');
      // Their other club is untouched, profile included (ADR 0012).
      const other = await db.membership.findFirstOrThrow({
        where: { id: s.memberships.memberB1 },
      });
      expect(other.phone).toBe(s.users.memberB1.phone);
    });

    it('restores a removed membership with its committees and their points', async () => {
      const person = s.users.removedOfficer;
      const before = await db.membership.findFirstOrThrow({
        where: { id: s.memberships.removedOfficer },
      });
      expect(before.removedAt).not.toBeNull();

      const result = await importFully(officerA, csv(`${person.fullName},${person.uniEmail},,,,,`));
      expect(result).toMatchObject({ added: 0, restored: 1 });

      const member = await memberByEmail(person.uniEmail);
      // The same membership id, so everything hanging off it comes back…
      expect(member.id).toBe(s.memberships.removedOfficer);
      expect(member.removedAt).toBeNull();
      // …and the officer role it had when it was removed does not (ADR 0017).
      expect(member.role).toBe('MEMBER');
      // The file named no committee, so the committee membership stays removed — its stale LEAD
      // role grants nothing while it is, which is why removal leaves it alone.
      expect(member.committeeMemberships.filter((row) => row.removedAt === null)).toEqual([]);
      expect(member.committeeMemberships).toHaveLength(1);
    });

    it('brings a removed committee membership back with its points when the file names it', async () => {
      // A member of A1 with points, removed from the club, then imported with لجنة أ1 again.
      const person = s.users.memberA1;
      const membershipId = s.memberships.memberA1;
      const pointsBefore = await getMemberPoints(officerA, membershipId, pointsQuery());
      expect(pointsBefore.totals.balance).toBe(10);

      await removeMember(officerA, membershipId);
      const result = await importFully(
        officerA,
        csv(`${person.fullName},${person.uniEmail},,,,,لجنة أ1`),
      );
      expect(result).toMatchObject({ restored: 1 });

      const member = await memberByEmail(person.uniEmail);
      expect(member.id).toBe(membershipId);
      expect(member.committeeMemberships.map((row) => row.committee.name)).toEqual(['لجنة أ1']);
      expect(member.committeeMemberships[0]?.role).toBe('MEMBER');
      const pointsAfter = await getMemberPoints(officerA, membershipId, pointsQuery());
      expect(pointsAfter.totals.balance).toBe(10);
      expect(pointsAfter.transactions.items.map((item) => item.id)).toEqual(
        pointsBefore.transactions.items.map((item) => item.id),
      );
    });

    it('adds an existing member to the committees the file names, and changes nothing else', async () => {
      const person = s.users.plain;
      const membership = await db.membership.findFirstOrThrow({
        where: { id: s.memberships.plain },
      });
      const result = await importFully(
        officerA,
        csv(`${person.fullName},${person.uniEmail},0559998888,كلية أخرى,1,عضو فعال,لجنة أ2`),
      );

      // An active member is skipped whole: the file does not edit this club's record of them.
      expect(result).toEqual({ added: 0, restored: 0, skippedExisting: 1, skippedInvalid: 0 });
      const after = await db.membership.findFirstOrThrow({ where: { id: s.memberships.plain } });
      expect(after).toEqual(membership);
      expect(
        await db.committeeMembership.count({ where: { membershipId: s.memberships.plain } }),
      ).toBe(0);
    });

    it('skips invalid rows and imports the rest', async () => {
      const before = await world();
      const result = await importFully(officerA, importFixture('problems.csv'));
      expect(result).toEqual({ added: 2, restored: 0, skippedExisting: 0, skippedInvalid: 5 });

      expect(await db.membership.count({ where: { clubId: s.clubA.id } })).toBe(
        before.memberships.filter((row) => row.clubId === s.clubA.id).length + 2,
      );
      // The duplicated address was imported once, by its first row.
      expect(await db.user.count({ where: { uniEmail: 's441000302@uqu.edu.sa' } })).toBe(1);
      const duplicated = await memberByEmail('s441000302@uqu.edu.sa');
      expect(duplicated.committeeMemberships.map((row) => row.committee.name)).toEqual(['لجنة أ1']);
      // The rows that were refused left nothing at all.
      for (const uniEmail of ['s441000301@uqu.edu.sa', 's441000304@uqu.edu.sa']) {
        expect(await db.user.count({ where: { uniEmail } })).toBe(0);
      }
    });
  });

  describe('the import must match the preview', () => {
    it('refuses a checksum from a different file', async () => {
      const file = csv('طالب أول,s441002001@uqu.edu.sa,,,,,');
      const other = csv('طالب ثان,s441002002@uqu.edu.sa,,,,,');
      const preview = await previewMemberImport(officerA, s.clubA.id, { file: other });

      const before = await world();
      // A checksum that cannot match is refused outright: no transaction is opened for a request
      // that is already known to be stale. The plan is checked again inside the transaction too,
      // for the state that can change while it runs.
      const transaction = vi.spyOn(db, '$transaction');
      await expectConflict(
        confirmMemberImport(officerA, s.clubA.id, { file, checksum: preview.checksum }),
        'import_changed',
      );
      expect(transaction).not.toHaveBeenCalled();
      transaction.mockRestore();
      expect(await world()).toEqual(before);
    });

    it('refuses the whole import when one row changed state since the preview', async () => {
      const newcomer = { uniEmail: 's441002101@uqu.edu.sa', fullName: 'طالب جديد' };
      const file = csv(
        `${newcomer.fullName},${newcomer.uniEmail},,,,,`,
        'طالب آخر,s441002102@uqu.edu.sa,,,,,',
      );
      const preview = await previewMemberImport(officerA, s.clubA.id, { file });
      expect(preview.summary).toMatchObject({ add: 2 });

      // Somebody adds one of them in the meantime: that row is now `existing`, not `add`.
      await createMember(officerA, s.clubA.id, { person: newcomer, profile: {}, committeeIds: [] });

      const before = await world();
      await expectConflict(
        confirmMemberImport(officerA, s.clubA.id, { file, checksum: preview.checksum }),
        'import_changed',
      );
      // Not even the untouched row was imported.
      expect(await world()).toEqual(before);
      expect(await db.user.count({ where: { uniEmail: 's441002102@uqu.edu.sa' } })).toBe(0);
    });

    it('refuses it when a committee the file names has been renamed since', async () => {
      const file = csv('طالب ثالث,s441002201@uqu.edu.sa,,,,,لجنة أ2');
      const preview = await previewMemberImport(officerA, s.clubA.id, { file });

      await db.committee.update({
        where: { id: s.committees.a2.id },
        data: { name: 'لجنة أ2 باسم جديد' },
      });
      const before = await world();
      await expectConflict(
        confirmMemberImport(officerA, s.clubA.id, { file, checksum: preview.checksum }),
        'import_changed',
      );
      expect(await world()).toEqual(before);

      await db.committee.update({
        where: { id: s.committees.a2.id },
        data: { name: 'لجنة أ2' },
      });
    });

    it('imports nothing when the write fails halfway', async () => {
      const file = csv(
        'طالب رابع,s441002301@uqu.edu.sa,,,,,',
        'طالب خامس,s441002302@uqu.edu.sa,,,,,لجنة أ1',
      );
      const preview = await previewMemberImport(officerA, s.clubA.id, { file });
      const before = await world();

      // Every write of the import runs, and then the transaction fails before it commits:
      // nothing may survive, not the accounts, not the memberships, not the committees.
      const transaction = db.$transaction.bind(db);
      const spy = vi.spyOn(db, '$transaction').mockImplementationOnce((async (
        run: (tx: unknown) => Promise<unknown>,
      ) =>
        transaction(async (tx) => {
          await run(tx);
          throw new Error('the database went away');
        })) as unknown as typeof db.$transaction);

      await expect(
        confirmMemberImport(officerA, s.clubA.id, { file, checksum: preview.checksum }),
      ).rejects.toThrow('the database went away');
      spy.mockRestore();

      expect(await world()).toEqual(before);
      expect(await db.user.count({ where: { uniEmail: 's441002301@uqu.edu.sa' } })).toBe(0);
    });
  });

  describe('the club', () => {
    it('refuses an archived club', async () => {
      const officerZ = await actorFor(a.users.officerZ.id);
      const file = csv('طالب سادس,s441002401@uqu.edu.sa,,,,,');
      await expectConflict(
        confirmMemberImport(officerZ, a.archivedClub.id, { file, checksum: 'f'.repeat(64) }),
        'club_archived',
      );
    });

    it('refuses a club with no membership types yet', async () => {
      const empty = await db.club.create({
        data: { slug: `club-empty-${Date.now()}`, name: 'نادي بلا أنواع' },
      });
      await expectConflict(
        previewMemberImport(admin, empty.id, { file: csv('طالب,s441002501@uqu.edu.sa,,,,,') }),
        'club_has_no_membership_types',
      );
    });
  });
});
