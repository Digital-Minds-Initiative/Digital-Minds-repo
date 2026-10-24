import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { addMemberToCommittee, removeMemberFromCommittee } from '@/server/modules/members';
import { setMemberCommitteeRole } from '@/server/modules/permissions';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import {
  expectConflict,
  expectForbidden,
  expectInvalid,
  expectNotFound,
} from '@tests/utils/assertions';

/** Committee leads are appointed by the club's own officers and by full admins (ADR 0018). */
describe('the committee lead role', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const committeeRoleOf = async (memberId: string, committeeId: string) =>
    (
      await db.committeeMembership.findUniqueOrThrow({
        where: { membershipId_committeeId: { membershipId: memberId, committeeId } },
      })
    ).role;
  const historyFor = (memberId: string) =>
    db.roleChange.findMany({ where: { membershipId: memberId }, orderBy: { createdAt: 'asc' } });
  /** Rows for one member, or for one member in one committee. Counted as a delta: the members of
   * the shared scenario pick up history as this file goes along. */
  const historyCount = (memberId: string, committeeId?: string) =>
    db.roleChange.count({
      where: { membershipId: memberId, ...(committeeId ? { committeeId } : {}) },
    });

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

  describe('an officer of the club', () => {
    it('appoints and revokes, writing one history row for each', async () => {
      const member = s.memberships.memberA1;
      const appointed = await setMemberCommitteeRole(officerA, member, s.committees.a1.id, 'LEAD');
      expect(appointed.member.committees).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: s.committees.a1.id, role: 'LEAD' })]),
      );

      await setMemberCommitteeRole(officerA, member, s.committees.a1.id, 'MEMBER');
      expect(await historyFor(member)).toMatchObject([
        {
          clubId: s.clubA.id,
          committeeId: s.committees.a1.id,
          changedById: s.users.officerA.id,
          previousRole: 'MEMBER',
          newRole: 'LEAD',
        },
        {
          committeeId: s.committees.a1.id,
          previousRole: 'LEAD',
          newRole: 'MEMBER',
        },
      ]);
    });

    it('leaves a committee with several leads', async () => {
      // A1 already has leadA1 and coLeadA1.
      await setMemberCommitteeRole(officerA, s.memberships.memberA1, s.committees.a1.id, 'LEAD');
      const leads = await db.committeeMembership.count({
        where: { committeeId: s.committees.a1.id, role: 'LEAD', removedAt: null },
      });
      expect(leads).toBe(3);
      // All three really lead it: each one's actor has the committee in scope.
      for (const userId of [s.users.leadA1.id, s.users.coLeadA1.id, s.users.memberA1.id]) {
        const actor = await actorFor(userId);
        expect(
          actor.memberships.flatMap((membership) =>
            membership.committees.filter((committee) => committee.role === 'LEAD'),
          ),
        ).toEqual(
          expect.arrayContaining([expect.objectContaining({ committeeId: s.committees.a1.id })]),
        );
      }
      await setMemberCommitteeRole(officerA, s.memberships.memberA1, s.committees.a1.id, 'MEMBER');
    });

    it('may appoint themselves, which grants them nothing new', async () => {
      await addMemberToCommittee(officerA, s.memberships.officerA, s.committees.a2.id);
      await expect(
        setMemberCommitteeRole(officerA, s.memberships.officerA, s.committees.a2.id, 'LEAD'),
      ).resolves.toMatchObject({ member: { id: s.memberships.officerA } });
      expect(await committeeRoleOf(s.memberships.officerA, s.committees.a2.id)).toBe('LEAD');
      await setMemberCommitteeRole(officerA, s.memberships.officerA, s.committees.a2.id, 'MEMBER');
      await removeMemberFromCommittee(officerA, s.memberships.officerA, s.committees.a2.id);
    });

    it('appoints in any committee of their club, not only ones they are in', async () => {
      await expect(
        setMemberCommitteeRole(officerA, s.memberships.memberA2, s.committees.a2.id, 'LEAD'),
      ).resolves.toBeTruthy();
      await setMemberCommitteeRole(officerA, s.memberships.memberA2, s.committees.a2.id, 'MEMBER');
    });
  });

  describe('a no-op', () => {
    it('writes nothing, for a role already held and for one not held', async () => {
      const before = await db.committeeMembership.findUniqueOrThrow({
        where: {
          membershipId_committeeId: {
            membershipId: s.memberships.leadA1,
            committeeId: s.committees.a1.id,
          },
        },
      });
      await expect(
        setMemberCommitteeRole(admin, s.memberships.leadA1, s.committees.a1.id, 'LEAD'),
      ).resolves.toBeTruthy();
      expect(
        await db.committeeMembership.findUniqueOrThrow({
          where: {
            membershipId_committeeId: {
              membershipId: s.memberships.leadA1,
              committeeId: s.committees.a1.id,
            },
          },
        }),
      ).toEqual(before);

      const rowsA2 = await historyCount(s.memberships.memberA2);
      await expect(
        setMemberCommitteeRole(admin, s.memberships.memberA2, s.committees.a2.id, 'MEMBER'),
      ).resolves.toBeTruthy();
      expect(await historyCount(s.memberships.memberA2)).toBe(rowsA2);
      expect(await historyFor(s.memberships.leadA1)).toHaveLength(0);
    });
  });

  describe('everyone else', () => {
    it('refuses a committee lead appointing another lead of their own committee', async () => {
      const rows = await historyCount(s.memberships.memberA1);
      await expectForbidden(
        setMemberCommitteeRole(leadA1, s.memberships.memberA1, s.committees.a1.id, 'LEAD'),
        'club_management_required',
      );
      expect(await committeeRoleOf(s.memberships.memberA1, s.committees.a1.id)).toBe('MEMBER');
      expect(await historyCount(s.memberships.memberA1)).toBe(rows);
    });

    it('is a 404 for an officer of another club and for a plain member', async () => {
      await expectNotFound(
        setMemberCommitteeRole(officerB, s.memberships.memberA1, s.committees.a1.id, 'LEAD'),
      );
      await expectNotFound(
        setMemberCommitteeRole(plain, s.memberships.memberA1, s.committees.a1.id, 'LEAD'),
      );
      expect(await committeeRoleOf(s.memberships.memberA1, s.committees.a1.id)).toBe('MEMBER');
    });
  });

  describe('state that blocks a change', () => {
    it('refuses someone who is not in the committee', async () => {
      await expectConflict(
        setMemberCommitteeRole(officerA, s.memberships.plain, s.committees.a1.id, 'LEAD'),
        'not_in_committee',
      );
      expect(await historyFor(s.memberships.plain)).toHaveLength(0);
    });

    it('refuses someone whose committee membership was removed', async () => {
      // staleLead's A1 row is there but removed, so it grants nothing and cannot be promoted.
      expect(await committeeRoleOf(s.memberships.staleLead, s.committees.a1.id)).toBe('LEAD');
      await expectConflict(
        setMemberCommitteeRole(officerA, s.memberships.staleLead, s.committees.a1.id, 'MEMBER'),
        'not_in_committee',
      );
      expect(await historyFor(s.memberships.staleLead)).toHaveLength(0);
    });

    it('refuses a committee of another club with a located 422', async () => {
      await expectInvalid(
        setMemberCommitteeRole(admin, s.memberships.memberA1, s.committees.b1.id, 'LEAD'),
        'committee_not_in_club',
      );
    });

    it('refuses an archived committee and an archived club', async () => {
      await expectConflict(
        setMemberCommitteeRole(admin, a.memberships.memberA3, a.archivedCommittee.id, 'LEAD'),
        'committee_archived',
      );
      await expectConflict(
        setMemberCommitteeRole(admin, a.memberships.memberZ1, a.z1.id, 'LEAD'),
        'club_archived',
      );
      expect(await historyFor(a.memberships.memberA3)).toHaveLength(0);
      expect(await historyFor(a.memberships.memberZ1)).toHaveLength(0);
    });
  });

  describe('two grants at the same moment', () => {
    it('write one history row and both answer with the member', async () => {
      const member = s.memberships.memberA2;
      const committeeId = s.committees.a2.id;
      expect(await committeeRoleOf(member, committeeId)).toBe('MEMBER');
      const rows = await historyCount(member, committeeId);

      const results = await Promise.allSettled([
        setMemberCommitteeRole(admin, member, committeeId, 'LEAD'),
        setMemberCommitteeRole(admin, member, committeeId, 'LEAD'),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const result of results) {
        expect(result.status === 'fulfilled' && result.value.member.id).toBe(member);
      }
      expect(await committeeRoleOf(member, committeeId)).toBe('LEAD');
      // The loser's update matched nothing, so it recorded nothing: one grant, one row.
      expect(await historyCount(member, committeeId)).toBe(rows + 1);
    });
  });

  describe('a lead role cleared by removal', () => {
    it('leaves no history row, and coming back to the committee is not leading it', async () => {
      const member = s.memberships.memberA1;
      await setMemberCommitteeRole(officerA, member, s.committees.a1.id, 'LEAD');
      const rows = await historyCount(member);

      await removeMemberFromCommittee(officerA, member, s.committees.a1.id);
      expect(await committeeRoleOf(member, s.committees.a1.id)).toBe('MEMBER');
      expect(await historyCount(member)).toBe(rows);

      await addMemberToCommittee(officerA, member, s.committees.a1.id);
      expect(await committeeRoleOf(member, s.committees.a1.id)).toBe('MEMBER');
      expect(await historyCount(member)).toBe(rows);
    });
  });
});
