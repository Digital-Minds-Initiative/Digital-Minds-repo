import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  archiveClub,
  archiveCommittee,
  createCommittee,
  createMembershipType,
  listClubs,
  listCommittees,
  restoreClub,
  restoreCommittee,
  updateCommittee,
} from '@/server/modules/clubs';
import { addMemberToCommittee, createMember } from '@/server/modules/members';
import { createPointTransaction } from '@/server/modules/points';
import { includeArchivedQuerySchema } from '@/shared/contracts/clubs';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  today,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/**
 * Archive instead of delete (ADR 0015): an archived club or committee is hidden from the default
 * lists and accepts nothing new, while everything already in it stays readable.
 */
describe('archiving', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerZ: Actor;
  let leadA1: Actor;

  const query = (input: Record<string, unknown> = {}) => includeArchivedQuerySchema.parse(input);
  const newPerson = () => ({
    uniEmail: `${crypto.randomUUID().replaceAll('-', '')}@st.uqu.edu.sa`,
    fullName: 'طالب جديد',
  });

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerZ, leadA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(a.users.officerZ.id),
      actorFor(s.users.leadA1.id),
    ]);
  });

  describe('lists', () => {
    it('hides an archived club unless it is asked for', async () => {
      const active = await listClubs(admin, query());
      expect(active.items.map((club) => club.id)).not.toContain(a.archivedClub.id);

      const all = await listClubs(admin, query({ includeArchived: true }));
      const archived = all.items.find((club) => club.id === a.archivedClub.id);
      expect(archived?.archivedAt).toBe(a.archivedClub.archivedAt?.toISOString());
    });

    it('lets the officer of an archived club still open it', async () => {
      await expect(listClubs(officerZ, query({ includeArchived: true }))).resolves.toMatchObject({
        items: [{ id: a.archivedClub.id }],
      });
    });

    it('hides an archived committee, and every committee of an archived club', async () => {
      const active = await listCommittees(officerA, s.clubA.id, query());
      expect(active.items.map((committee) => committee.id)).not.toContain(a.archivedCommittee.id);
      expect(
        (await listCommittees(officerA, s.clubA.id, query({ includeArchived: true }))).items.map(
          (committee) => committee.id,
        ),
      ).toContain(a.archivedCommittee.id);

      // z1 is active, but its club is archived.
      await expect(listCommittees(officerZ, a.archivedClub.id, query())).resolves.toEqual({
        items: [],
      });
      expect(
        (
          await listCommittees(officerZ, a.archivedClub.id, query({ includeArchived: true }))
        ).items.map((committee) => committee.id),
      ).toEqual([a.z1.id]);
    });
  });

  describe('an archived club accepts nothing new', () => {
    it('refuses a new member', async () => {
      await expectConflict(
        createMember(admin, a.archivedClub.id, {
          person: newPerson(),
          profile: {},
          committeeIds: [],
        }),
        'club_archived',
      );
    });

    it('refuses a new committee membership, even in an active committee', async () => {
      expect(await db.committee.findUnique({ where: { id: a.z1.id } })).toMatchObject({
        archivedAt: null,
      });
      await expectConflict(
        addMemberToCommittee(admin, a.memberships.memberZ, a.z1.id),
        'club_archived',
      );
      expect(
        await db.committeeMembership.count({
          where: { membershipId: a.memberships.memberZ, committeeId: a.z1.id },
        }),
      ).toBe(0);
    });

    it('refuses new points, even in an active committee', async () => {
      await expectConflict(
        createPointTransaction(admin, a.memberships.memberZ1, a.z1.id, {
          amount: 5,
          reason: 'نشاط',
          workDate: today(),
        }),
        'club_archived',
      );
      expect(await db.pointTransaction.count({ where: { clubId: a.archivedClub.id } })).toBe(0);
    });

    it('refuses a new committee and a new membership type', async () => {
      await expectConflict(
        createCommittee(admin, a.archivedClub.id, { name: 'لجنة بعد الأرشفة' }),
        'club_archived',
      );
      await expectConflict(
        createMembershipType(officerZ, a.archivedClub.id, { name: 'نوع بعد الأرشفة' }),
        'club_archived',
      );
    });
  });

  describe('an archived committee accepts nothing new', () => {
    it('refuses a new club member placed into it', async () => {
      await expectConflict(
        createMember(admin, s.clubA.id, {
          person: newPerson(),
          profile: {},
          committeeIds: [a.archivedCommittee.id],
        }),
        'committee_archived',
      );
    });

    it('refuses adding an existing member to it', async () => {
      await expectConflict(
        addMemberToCommittee(admin, s.memberships.plain, a.archivedCommittee.id),
        'committee_archived',
      );
    });

    it('refuses new points in it', async () => {
      await expectConflict(
        createPointTransaction(admin, a.memberships.memberA3, a.archivedCommittee.id, {
          amount: 5,
          reason: 'نشاط',
          workDate: today(),
        }),
        'committee_archived',
      );
    });

    it('keeps its members and their history readable', async () => {
      const members = await db.committeeMembership.findMany({
        where: { committeeId: a.archivedCommittee.id, removedAt: null },
      });
      expect(members).toHaveLength(1);
      await expect(
        updateCommittee(admin, a.archivedCommittee.id, { description: 'لجنة منتهية' }),
      ).resolves.toMatchObject({ description: 'لجنة منتهية', archivedAt: expect.any(String) });
    });
  });

  describe('archiving and restoring', () => {
    it('is a full admin’s job alone', async () => {
      for (const actor of [officerA, leadA1]) {
        await expectForbidden(archiveClub(actor, s.clubA.id), 'full_admin_required');
        await expectForbidden(restoreClub(actor, s.clubA.id), 'full_admin_required');
        await expectForbidden(archiveCommittee(actor, s.committees.a1.id), 'full_admin_required');
        await expectForbidden(restoreCommittee(actor, s.committees.a1.id), 'full_admin_required');
      }
      await expectForbidden(archiveClub(officerZ, a.archivedClub.id), 'full_admin_required');
      expect(await db.club.findUnique({ where: { id: s.clubA.id } })).toMatchObject({
        archivedAt: null,
      });
    });

    it('is a 404 outside the actor’s scope', async () => {
      await expectNotFound(archiveClub(officerA, s.clubB.id));
      await expectNotFound(archiveCommittee(leadA1, s.committees.a2.id));
    });

    it('archives and restores a club, and is idempotent both ways', async () => {
      const club = await db.club.create({
        data: { slug: `club-arch-${crypto.randomUUID()}`, name: `نادي للأرشفة ${Date.now()}` },
      });

      const archived = await archiveClub(admin, club.id);
      expect(archived.archivedAt).not.toBeNull();
      // Archiving again keeps the first date: nothing new happened.
      await expect(archiveClub(admin, club.id)).resolves.toEqual(archived);

      await expect(restoreClub(admin, club.id)).resolves.toMatchObject({ archivedAt: null });
      await expect(restoreClub(admin, club.id)).resolves.toMatchObject({ archivedAt: null });
    });

    it('restores a club without touching committees archived separately', async () => {
      const club = await db.club.create({
        data: { slug: `club-both-${crypto.randomUUID()}`, name: `نادي الاثنين ${Date.now()}` },
      });
      const keep = await createCommittee(admin, club.id, { name: 'لجنة نشطة' });
      const gone = await createCommittee(admin, club.id, { name: 'لجنة مؤرشفة' });
      await archiveCommittee(admin, gone.id);
      await archiveClub(admin, club.id);

      await restoreClub(admin, club.id);
      expect(await db.committee.findUnique({ where: { id: keep.id } })).toMatchObject({
        archivedAt: null,
      });
      expect(await db.committee.findUnique({ where: { id: gone.id } })).toMatchObject({
        archivedAt: expect.any(Date),
      });
    });

    it('refuses to restore a committee while its club is archived', async () => {
      await archiveCommittee(admin, a.z1.id);
      await expectConflict(restoreCommittee(admin, a.z1.id), 'club_archived');
      expect(await db.committee.findUnique({ where: { id: a.z1.id } })).toMatchObject({
        archivedAt: expect.any(Date),
      });

      // With the club back, the committee can be restored again.
      await restoreClub(admin, a.archivedClub.id);
      await expect(restoreCommittee(admin, a.z1.id)).resolves.toMatchObject({ archivedAt: null });
      await archiveClub(admin, a.archivedClub.id);
    });
  });
});
