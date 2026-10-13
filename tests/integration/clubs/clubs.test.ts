import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createClub, listClubs, listMembershipTypes, updateClub } from '@/server/modules/clubs';
import { DEFAULT_MEMBERSHIP_TYPE_NAME, includeArchivedQuerySchema } from '@/shared/contracts/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/** Clubs: read inside the actor's scope, written by full admins only. */
describe('clubs', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const query = (input: Record<string, unknown> = {}) => includeArchivedQuerySchema.parse(input);

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, leadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  describe('reading', () => {
    it('shows a full admin every club', async () => {
      const { items } = await listClubs(admin, query());
      expect(items.map((club) => club.id).sort()).toEqual([s.clubA.id, s.clubB.id].sort());
    });

    it('shows an officer only their club, with exactly the contract fields', async () => {
      const { items } = await listClubs(officerA, query());
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        id: s.clubA.id,
        slug: s.clubA.slug,
        name: s.clubA.name,
        description: null,
        archivedAt: null,
      });
    });

    it('shows a lead the club of the committee they lead', async () => {
      const { items } = await listClubs(leadA1, query());
      expect(items.map((club) => club.id)).toEqual([s.clubA.id]);
    });

    it('shows a plain member nothing', async () => {
      await expect(listClubs(plain, query())).resolves.toEqual({ items: [] });
    });
  });

  describe('creating', () => {
    it('starts the club with the default membership type', async () => {
      const club = await createClub(admin, { name: 'نادي الروبوت', slug: 'robotics' });
      expect(club).toMatchObject({ slug: 'robotics', name: 'نادي الروبوت', archivedAt: null });

      const { items } = await listMembershipTypes(admin, club.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        name: DEFAULT_MEMBERSHIP_TYPE_NAME,
        order: 0,
        activeMemberCount: 0,
        inUse: false,
      });
    });

    it('refuses every actor who is not a full admin', async () => {
      for (const actor of [officerA, leadA1, plain]) {
        await expectForbidden(
          createClub(actor, { name: 'نادي جديد', slug: 'brand-new' }),
          'full_admin_required',
        );
      }
      expect(await db.club.count({ where: { slug: 'brand-new' } })).toBe(0);
    });

    it('refuses a name already taken, and tells it apart from the slug', async () => {
      await expectConflict(
        createClub(admin, { name: s.clubA.name, slug: 'another-slug' }),
        'name_taken',
      );
      await expectConflict(
        createClub(admin, { name: 'اسم جديد تماماً', slug: s.clubA.slug }),
        'slug_taken',
      );
      expect(await db.club.count({ where: { slug: 'another-slug' } })).toBe(0);
    });

    it('treats a name with repeated spaces as the same name', async () => {
      const club = await createClub(admin, { name: 'نادي  المسارات', slug: 'tracks' });
      expect(club.name).toBe('نادي المسارات');
      await expectConflict(
        createClub(admin, { name: '  نادي   المسارات ', slug: 'tracks-two' }),
        'name_taken',
      );
    });
  });

  describe('updating', () => {
    let clubId: string;

    beforeAll(async () => {
      const club = await createClub(admin, { name: 'نادي قابل للتعديل', slug: 'editable' });
      clubId = club.id;
    });

    it('renames the club and keeps the slug', async () => {
      const updated = await updateClub(admin, clubId, { name: 'نادي بعد التعديل' });
      expect(updated).toMatchObject({ name: 'نادي بعد التعديل', slug: 'editable' });
    });

    it('sets and clears the description', async () => {
      await expect(updateClub(admin, clubId, { description: 'وصف' })).resolves.toMatchObject({
        description: 'وصف',
      });
      await expect(updateClub(admin, clubId, { description: null })).resolves.toMatchObject({
        description: null,
      });
    });

    it('refuses an officer of that very club', async () => {
      await expectForbidden(
        updateClub(officerA, s.clubA.id, { name: 'اسم من المدير' }),
        'full_admin_required',
      );
      expect(await db.club.findUnique({ where: { id: s.clubA.id } })).toMatchObject({
        name: s.clubA.name,
      });
    });

    it('is a 404 for a club outside the actor’s scope', async () => {
      // Club B is invisible to officer A: "not yours" must look like "does not exist".
      await expectNotFound(updateClub(officerA, s.clubB.id, { name: 'اسم' }));
      await expectNotFound(updateClub(plain, s.clubA.id, { name: 'اسم' }));
    });

    it('refuses a rename to another club’s name', async () => {
      await expectConflict(updateClub(admin, clubId, { name: s.clubB.name }), 'name_taken');
    });

    it('allows renaming a club to its own name', async () => {
      const club = await db.club.findUniqueOrThrow({ where: { id: clubId } });
      await expect(updateClub(admin, clubId, { name: club.name })).resolves.toMatchObject({
        name: club.name,
      });
    });
  });
});
