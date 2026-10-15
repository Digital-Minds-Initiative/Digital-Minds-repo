import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  createMembershipType,
  deleteMembershipType,
  listMembershipTypes,
  updateMembershipType,
} from '@/server/modules/clubs';
import { deleteMembershipTypeQuerySchema } from '@/shared/contracts/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import {
  expectConflict,
  expectForbidden,
  expectInvalid,
  expectNotFound,
} from '@tests/utils/assertions';

/** Membership types: read by anyone who sees the club, managed by its officers and full admins. */
describe('membership types', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const del = (input: Record<string, unknown> = {}) => deleteMembershipTypeQuerySchema.parse(input);

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
    it('counts active members and reports whether the type is in use', async () => {
      const { items } = await listMembershipTypes(officerA, s.clubA.id);
      const inUse = items.find((type) => type.id === s.types.a);
      const unused = items.find((type) => type.id === s.types.a2);
      expect(inUse).toMatchObject({ clubId: s.clubA.id, order: 0, inUse: true });
      expect(inUse?.activeMemberCount).toBe(
        await db.membership.count({ where: { membershipTypeId: s.types.a, removedAt: null } }),
      );
      expect(unused).toMatchObject({ order: 1, activeMemberCount: 0, inUse: false });
    });

    it('leaves removed memberships out of the count but keeps the type in use', async () => {
      // removedOfficer is removed from club A and still holds type A.
      const removed = await db.membership.count({
        where: { membershipTypeId: s.types.a, removedAt: { not: null } },
      });
      expect(removed).toBeGreaterThan(0);
      const { items } = await listMembershipTypes(admin, s.clubA.id);
      const type = items.find((candidate) => candidate.id === s.types.a);
      expect(type?.activeMemberCount).toBe(
        await db.membership.count({ where: { membershipTypeId: s.types.a, removedAt: null } }),
      );
      expect(type?.inUse).toBe(true);
    });

    it('is readable by a committee lead of the club', async () => {
      const { items } = await listMembershipTypes(leadA1, s.clubA.id);
      expect(items.map((type) => type.id).sort()).toEqual([s.types.a, s.types.a2].sort());
    });

    it('is a 404 for a club the actor cannot see', async () => {
      await expectNotFound(listMembershipTypes(officerA, s.clubB.id));
      await expectNotFound(listMembershipTypes(plain, s.clubA.id));
    });
  });

  describe('creating', () => {
    it('appends the type at the end of the club’s order', async () => {
      const before = await listMembershipTypes(officerA, s.clubA.id);
      const created = await createMembershipType(officerA, s.clubA.id, { name: 'عضو شرف' });
      expect(created).toMatchObject({
        clubId: s.clubA.id,
        name: 'عضو شرف',
        order: before.items.length,
        activeMemberCount: 0,
        inUse: false,
      });
      await db.membershipType.delete({ where: { id: created.id } });
    });

    it('refuses a committee lead and a plain member of the club', async () => {
      await expectForbidden(
        createMembershipType(leadA1, s.clubA.id, { name: 'نوع من القائد' }),
        'club_management_required',
      );
      // A plain member cannot see the club at all, so it does not exist for them.
      await expectNotFound(createMembershipType(plain, s.clubA.id, { name: 'نوع' }));
      expect(await db.membershipType.count({ where: { name: 'نوع من القائد' } })).toBe(0);
    });

    it('refuses an officer of another club', async () => {
      await expectNotFound(createMembershipType(officerB, s.clubA.id, { name: 'نوع' }));
      expect(await db.membershipType.count({ where: { clubId: s.clubA.id, name: 'نوع' } })).toBe(0);
    });

    it('refuses a name the club already uses, however it is spaced', async () => {
      await expectConflict(
        createMembershipType(officerA, s.clubA.id, { name: 'عضو فعال' }),
        'name_taken',
      );
      await expectConflict(
        createMembershipType(officerA, s.clubA.id, { name: 'عضو   فعال ' }),
        'name_taken',
      );
    });

    it('allows the same type name in another club', async () => {
      const created = await createMembershipType(officerB, s.clubB.id, { name: 'عضو فعال' });
      expect(created.clubId).toBe(s.clubB.id);
      await db.membershipType.delete({ where: { id: created.id } });
    });
  });

  describe('renaming', () => {
    it('renames the type', async () => {
      const created = await createMembershipType(officerA, s.clubA.id, { name: 'اسم أول' });
      await expect(
        updateMembershipType(officerA, created.id, { name: 'اسم  ثانٍ' }),
      ).resolves.toMatchObject({ id: created.id, name: 'اسم ثانٍ', order: created.order });
      await db.membershipType.delete({ where: { id: created.id } });
    });

    it('refuses a lead, and a 404 for another club’s type', async () => {
      await expectForbidden(
        updateMembershipType(leadA1, s.types.a, { name: 'اسم من القائد' }),
        'club_management_required',
      );
      await expectNotFound(updateMembershipType(officerA, s.types.b, { name: 'اسم' }));
      expect(await db.membershipType.findUnique({ where: { id: s.types.a } })).toMatchObject({
        name: 'عضو',
      });
    });

    it('refuses a rename onto a sibling’s name', async () => {
      await expectConflict(
        updateMembershipType(officerA, s.types.a2, { name: 'عضو' }),
        'name_taken',
      );
    });
  });

  describe('deleting', () => {
    let clubId: string;
    let types: { keep: string; spare: string; doomed: string };

    /** A club of its own, so the delete cases cannot disturb the shared scenario. */
    beforeEach(async () => {
      const club = await db.club.create({
        data: { slug: `club-del-${crypto.randomUUID()}`, name: `نادي الحذف ${Date.now()}` },
      });
      clubId = club.id;
      const [keep, spare, doomed] = await Promise.all([
        db.membershipType.create({ data: { clubId, name: 'أساسي', order: 0 } }),
        db.membershipType.create({ data: { clubId, name: 'بديل', order: 1 } }),
        db.membershipType.create({ data: { clubId, name: 'للحذف', order: 2 } }),
      ]);
      types = { keep: keep.id, spare: spare.id, doomed: doomed.id };
    });

    async function addMember(membershipTypeId: string, options: { removed?: boolean } = {}) {
      const user = await db.user.create({
        data: {
          fullName: 'عضو الحذف',
          searchName: 'عضو الحذف',
          uniEmail: `${crypto.randomUUID()}@st.uqu.edu.sa`,
          registeredAt: new Date(),
        },
      });
      return db.membership.create({
        data: {
          userId: user.id,
          clubId,
          membershipTypeId,
          removedAt: options.removed ? new Date() : null,
        },
      });
    }

    it('deletes an unused type and closes the gap in the order', async () => {
      await deleteMembershipType(admin, types.spare, del());
      expect(await db.membershipType.findUnique({ where: { id: types.spare } })).toBeNull();
      const rows = await db.membershipType.findMany({
        where: { clubId },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      expect(rows).toEqual([
        { id: types.keep, order: 0 },
        { id: types.doomed, order: 1 },
      ]);
    });

    it('moves the memberships when the request names another type of the club', async () => {
      const active = await addMember(types.doomed);
      const removed = await addMember(types.doomed, { removed: true });

      await deleteMembershipType(admin, types.doomed, del({ moveMembersTo: types.spare }));

      expect(await db.membershipType.findUnique({ where: { id: types.doomed } })).toBeNull();
      for (const membership of [active, removed]) {
        expect(await db.membership.findUnique({ where: { id: membership.id } })).toMatchObject({
          membershipTypeId: types.spare,
        });
      }
    });

    it('refuses a type in use without a target, and changes nothing', async () => {
      const membership = await addMember(types.doomed);
      await expectConflict(
        deleteMembershipType(admin, types.doomed, del()),
        'membership_type_in_use',
      );
      expect(await db.membershipType.count({ where: { id: types.doomed } })).toBe(1);
      expect(await db.membership.findUnique({ where: { id: membership.id } })).toMatchObject({
        membershipTypeId: types.doomed,
      });
    });

    it('refuses a target from another club, and changes nothing', async () => {
      await addMember(types.doomed);
      await expectInvalid(
        deleteMembershipType(admin, types.doomed, del({ moveMembersTo: s.types.a })),
        'membership_type_not_in_club',
      );
      expect(await db.membershipType.count({ where: { id: types.doomed } })).toBe(1);
      expect(
        await db.membership.count({ where: { clubId: s.clubA.id, membershipTypeId: s.types.a } }),
      ).toBeGreaterThan(0);
    });

    it('refuses the type itself as the target', async () => {
      await addMember(types.doomed);
      await expectInvalid(
        deleteMembershipType(admin, types.doomed, del({ moveMembersTo: types.doomed })),
        'move_target_is_same_type',
      );
      expect(await db.membershipType.count({ where: { id: types.doomed } })).toBe(1);
    });

    it('never deletes the club’s last type, used or not', async () => {
      await db.membershipType.deleteMany({ where: { id: { in: [types.spare, types.doomed] } } });
      await expectConflict(deleteMembershipType(admin, types.keep, del()), 'last_membership_type');
      expect(await db.membershipType.count({ where: { clubId } })).toBe(1);

      // In use as well: the last type is refused for being the last, not for being in use —
      // moving its members somewhere else is not an option when there is nowhere to move them.
      await addMember(types.keep);
      await expectConflict(deleteMembershipType(admin, types.keep, del()), 'last_membership_type');
      expect(await db.membershipType.count({ where: { clubId } })).toBe(1);
    });

    it('keeps one type when the last two are deleted at the same time', async () => {
      await db.membershipType.delete({ where: { id: types.doomed } });
      const results = await Promise.allSettled([
        deleteMembershipType(admin, types.keep, del()),
        deleteMembershipType(admin, types.spare, del()),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await db.membershipType.count({ where: { clubId } })).toBe(1);
    });

    it('is managed by the club’s officer, refused for a lead, and a 404 across clubs', async () => {
      await expectForbidden(
        deleteMembershipType(leadA1, s.types.a2, del()),
        'club_management_required',
      );
      await expectNotFound(deleteMembershipType(officerB, s.types.a2, del()));
      expect(await db.membershipType.count({ where: { id: s.types.a2 } })).toBe(1);

      const own = await createMembershipType(officerA, s.clubA.id, { name: 'نوع مؤقت' });
      await expect(deleteMembershipType(officerA, own.id, del())).resolves.toBeUndefined();
    });
  });
});
