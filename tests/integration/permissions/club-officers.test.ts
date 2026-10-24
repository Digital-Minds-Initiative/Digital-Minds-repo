import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createMember, removeMember } from '@/server/modules/members';
import { setMemberClubRole } from '@/server/modules/permissions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/** Club officers are appointed and revoked by full admins only (ADR 0018). */
describe('the club officer role', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const roleOf = async (memberId: string) =>
    (await db.membership.findUniqueOrThrow({ where: { id: memberId } })).role;
  const historyFor = (memberId: string) =>
    db.roleChange.findMany({ where: { membershipId: memberId }, orderBy: { createdAt: 'asc' } });

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

  describe('a full admin', () => {
    it('appoints and revokes, writing one history row for each', async () => {
      const member = s.memberships.memberA1;
      const appointed = await setMemberClubRole(admin, member, 'CLUB_OFFICER');
      expect(appointed.member).toMatchObject({ id: member, role: 'CLUB_OFFICER' });
      // They have signed in before: no invitation is due.
      expect(appointed.invitation).toBeNull();

      const revoked = await setMemberClubRole(admin, member, 'MEMBER');
      expect(revoked.member.role).toBe('MEMBER');

      expect(await historyFor(member)).toMatchObject([
        {
          clubId: s.clubA.id,
          committeeId: null,
          changedById: s.users.admin.id,
          previousRole: 'MEMBER',
          newRole: 'CLUB_OFFICER',
        },
        {
          clubId: s.clubA.id,
          committeeId: null,
          changedById: s.users.admin.id,
          previousRole: 'CLUB_OFFICER',
          newRole: 'MEMBER',
        },
      ]);
    });

    it('may take the last officer away from a club', async () => {
      const officers = await db.membership.count({
        where: { clubId: s.clubB.id, role: 'CLUB_OFFICER', removedAt: null },
      });
      expect(officers).toBe(1);
      await expect(
        setMemberClubRole(admin, s.memberships.officerB, 'MEMBER'),
      ).resolves.toMatchObject({ member: { role: 'MEMBER' } });
      // Put it back for the rest of the file.
      await setMemberClubRole(admin, s.memberships.officerB, 'CLUB_OFFICER');
    });

    it('may revoke their own officer role in a club — the full-admin flag is not an API matter', async () => {
      const selfOfficer = await setMemberClubRole(admin, s.memberships.mixedA, 'MEMBER');
      expect(selfOfficer.member.role).toBe('MEMBER');
      await setMemberClubRole(admin, s.memberships.mixedA, 'CLUB_OFFICER');
      expect(await db.user.findUniqueOrThrow({ where: { id: s.users.admin.id } })).toMatchObject({
        isFullAdmin: true,
      });
    });
  });

  describe('a no-op', () => {
    it('writes nothing and answers with the member', async () => {
      const member = s.memberships.officerA;
      expect(await roleOf(member)).toBe('CLUB_OFFICER');
      const before = await db.membership.findUniqueOrThrow({ where: { id: member } });

      await expect(setMemberClubRole(admin, member, 'CLUB_OFFICER')).resolves.toMatchObject({
        member: { id: member, role: 'CLUB_OFFICER' },
        invitation: null,
      });
      // Not even updatedAt moved, and no row was written.
      expect(await db.membership.findUniqueOrThrow({ where: { id: member } })).toEqual(before);
      expect(await historyFor(member)).toHaveLength(0);
    });

    it('covers revoking a role the person does not have', async () => {
      const member = s.memberships.memberA2;
      expect(await roleOf(member)).toBe('MEMBER');
      await expect(setMemberClubRole(admin, member, 'MEMBER')).resolves.toMatchObject({
        member: { role: 'MEMBER' },
      });
      expect(await historyFor(member)).toHaveLength(0);
    });
  });

  describe('everyone else', () => {
    it('is refused, including an officer of that very club', async () => {
      for (const actor of [officerA, leadA1]) {
        await expectForbidden(
          setMemberClubRole(actor, s.memberships.memberA1, 'CLUB_OFFICER'),
          'full_admin_required',
        );
      }
      expect(await roleOf(s.memberships.memberA1)).toBe('MEMBER');
      expect(await historyFor(s.memberships.memberA1)).toHaveLength(2); // only the admin's two
    });

    it('is refused for an officer changing their own role', async () => {
      await expectForbidden(
        setMemberClubRole(officerA, s.memberships.officerA, 'MEMBER'),
        'full_admin_required',
      );
      expect(await roleOf(s.memberships.officerA)).toBe('CLUB_OFFICER');
    });

    it('is refused for an officer changing another officer’s role in their club', async () => {
      await expectForbidden(
        setMemberClubRole(officerA, s.memberships.mixedA, 'MEMBER'),
        'full_admin_required',
      );
      expect(await roleOf(s.memberships.mixedA)).toBe('CLUB_OFFICER');
    });

    it('is a 404 for a member the actor cannot see', async () => {
      await expectNotFound(setMemberClubRole(officerB, s.memberships.memberA1, 'CLUB_OFFICER'));
      await expectNotFound(setMemberClubRole(plain, s.memberships.memberA1, 'CLUB_OFFICER'));
      expect(await roleOf(s.memberships.memberA1)).toBe('MEMBER');
    });
  });

  describe('state that blocks a change', () => {
    it('refuses a member who was removed from the club', async () => {
      await expectConflict(
        setMemberClubRole(admin, s.memberships.removedOfficer, 'CLUB_OFFICER'),
        'member_removed',
      );
      expect(await historyFor(s.memberships.removedOfficer)).toHaveLength(0);
    });

    it('refuses an archived club', async () => {
      const club = await db.club.create({
        data: { slug: `club-roles-${crypto.randomUUID()}`, name: `نادي الأدوار ${Date.now()}` },
      });
      const type = await db.membershipType.create({
        data: { clubId: club.id, name: 'عضو', order: 0 },
      });
      const member = await createMember(admin, club.id, {
        person: {
          uniEmail: `${crypto.randomUUID().replaceAll('-', '')}@st.uqu.edu.sa`,
          fullName: 'عضو مؤرشف',
        },
        profile: {},
        membershipTypeId: type.id,
        committeeIds: [],
      });
      await db.club.update({ where: { id: club.id }, data: { archivedAt: new Date() } });

      await expectConflict(setMemberClubRole(admin, member.id, 'CLUB_OFFICER'), 'club_archived');
      expect(await roleOf(member.id)).toBe('MEMBER');
      expect(await historyFor(member.id)).toHaveLength(0);
    });
  });

  describe('two grants at the same moment', () => {
    it('write one history row and both answer with the officer', async () => {
      const member = s.memberships.plain;
      expect(await roleOf(member)).toBe('MEMBER');

      const results = await Promise.allSettled([
        setMemberClubRole(admin, member, 'CLUB_OFFICER'),
        setMemberClubRole(admin, member, 'CLUB_OFFICER'),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const result of results) {
        expect(result.status === 'fulfilled' && result.value.member.role).toBe('CLUB_OFFICER');
      }

      expect(await roleOf(member)).toBe('CLUB_OFFICER');
      // The loser's update matched nothing, so it recorded nothing: one grant, one row.
      expect(await historyFor(member)).toHaveLength(1);
      await setMemberClubRole(admin, member, 'MEMBER');
    });
  });

  describe('a role cleared by removal', () => {
    it('leaves no history row, and the person comes back without the role', async () => {
      const person = {
        uniEmail: `${crypto.randomUUID().replaceAll('-', '')}@st.uqu.edu.sa`,
        fullName: 'عضو عاد',
      };
      const member = await createMember(admin, s.clubA.id, {
        person,
        profile: {},
        committeeIds: [s.committees.a1.id],
      });
      await setMemberClubRole(admin, member.id, 'CLUB_OFFICER');
      expect(await historyFor(member.id)).toHaveLength(1);

      await removeMember(officerA, member.id);
      expect(await roleOf(member.id)).toBe('MEMBER');
      // Removal is not a grant or a revoke: it writes no row here, and `removedAt` records it
      // instead (the known limit in ADR 0018).
      expect(await historyFor(member.id)).toHaveLength(1);

      const readded = await createMember(admin, s.clubA.id, {
        person,
        profile: {},
        committeeIds: [s.committees.a1.id],
      });
      expect(readded.id).toBe(member.id);
      expect(readded.role).toBe('MEMBER');
      expect(await historyFor(member.id)).toHaveLength(1);
    });
  });
});
