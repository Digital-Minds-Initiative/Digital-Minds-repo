import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createCommittee, listCommittees, updateCommittee } from '@/server/modules/clubs';
import { includeArchivedQuerySchema } from '@/shared/contracts/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/** Committees: read inside the actor's scope, written by full admins only. */
describe('committees', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const query = (input: Record<string, unknown> = {}) => includeArchivedQuerySchema.parse(input);

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  describe('reading', () => {
    it('shows an officer every committee of their club, with the contract fields', async () => {
      const { items } = await listCommittees(officerA, s.clubA.id, query());
      expect(items.map((committee) => committee.id).sort()).toEqual(
        [s.committees.a1.id, s.committees.a2.id].sort(),
      );
      expect(items[0]).toEqual({
        id: expect.any(String),
        clubId: s.clubA.id,
        name: expect.any(String),
        description: null,
        archivedAt: null,
      });
    });

    it('shows a lead only the committee they lead', async () => {
      const { items } = await listCommittees(leadA1, s.clubA.id, query());
      // leadA1 is a plain member of A2, which grants nothing there.
      expect(items.map((committee) => committee.id)).toEqual([s.committees.a1.id]);
    });

    it('shows a plain member of the club nothing', async () => {
      await expectNotFound(listCommittees(plain, s.clubA.id, query()));
    });

    it('is a 404 for another club', async () => {
      await expectNotFound(listCommittees(officerA, s.clubB.id, query()));
      await expectNotFound(listCommittees(officerB, s.clubA.id, query()));
    });
  });

  describe('creating', () => {
    it('adds a committee to the club', async () => {
      const committee = await createCommittee(admin, s.clubB.id, {
        name: 'لجنة جديدة',
        description: 'وصف اللجنة',
      });
      expect(committee).toMatchObject({
        clubId: s.clubB.id,
        name: 'لجنة جديدة',
        description: 'وصف اللجنة',
        archivedAt: null,
      });
    });

    it('refuses every actor who is not a full admin, including the club’s officer', async () => {
      for (const actor of [officerA, leadA1]) {
        await expectForbidden(
          createCommittee(actor, s.clubA.id, { name: 'لجنة من غير مسؤول' }),
          'full_admin_required',
        );
      }
      expect(await db.committee.count({ where: { name: 'لجنة من غير مسؤول' } })).toBe(0);
    });

    it('is a 404 before a 403 for a club the actor cannot see', async () => {
      await expectNotFound(createCommittee(officerB, s.clubA.id, { name: 'لجنة' }));
      await expectNotFound(createCommittee(plain, s.clubA.id, { name: 'لجنة' }));
    });

    it('refuses a name another committee of the same club already has', async () => {
      await expectConflict(
        createCommittee(admin, s.clubA.id, { name: s.committees.a1.name }),
        'name_taken',
      );
      // Spacing does not make it a different name.
      await expectConflict(
        createCommittee(admin, s.clubA.id, { name: `  ${s.committees.a1.name}  ` }),
        'name_taken',
      );
    });

    it('allows the same committee name in another club', async () => {
      await expect(
        createCommittee(admin, s.clubB.id, { name: s.committees.a1.name }),
      ).resolves.toMatchObject({ clubId: s.clubB.id, name: s.committees.a1.name });
    });
  });

  describe('updating', () => {
    it('renames the committee and keeps it in its club', async () => {
      const committee = await createCommittee(admin, s.clubB.id, { name: 'لجنة قابلة للتعديل' });
      const updated = await updateCommittee(admin, committee.id, { name: 'لجنة  بعد  التعديل' });
      expect(updated).toMatchObject({
        id: committee.id,
        clubId: s.clubB.id,
        name: 'لجنة بعد التعديل',
      });
    });

    it('refuses the club’s own officer and its lead', async () => {
      await expectForbidden(
        updateCommittee(officerA, s.committees.a1.id, { name: 'اسم من المدير' }),
        'full_admin_required',
      );
      await expectForbidden(
        updateCommittee(leadA1, s.committees.a1.id, { name: 'اسم من القائد' }),
        'full_admin_required',
      );
      expect(await db.committee.findUnique({ where: { id: s.committees.a1.id } })).toMatchObject({
        name: s.committees.a1.name,
      });
    });

    it('is a 404 for a committee outside the actor’s scope', async () => {
      await expectNotFound(updateCommittee(officerA, s.committees.b1.id, { name: 'اسم' }));
      // A lead cannot even address another committee of their own club.
      await expectNotFound(updateCommittee(leadA1, s.committees.a2.id, { name: 'اسم' }));
    });

    it('refuses a rename onto a sibling’s name', async () => {
      await expectConflict(
        updateCommittee(admin, s.committees.a1.id, { name: s.committees.a2.name }),
        'name_taken',
      );
    });

    it('sets and clears the description', async () => {
      await expect(
        updateCommittee(admin, s.committees.a1.id, { description: 'وصف' }),
      ).resolves.toMatchObject({ description: 'وصف' });
      await expect(
        updateCommittee(admin, s.committees.a1.id, { description: null }),
      ).resolves.toMatchObject({ description: null });
    });
  });
});
