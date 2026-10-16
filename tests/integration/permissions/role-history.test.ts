import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  getClubPermissions,
  listRoleHistory,
  setMemberClubRole,
  setMemberCommitteeRole,
} from '@/server/modules/permissions';
import { roleChangeSchema, roleHistoryQuerySchema } from '@/shared/contracts/permissions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectForbidden, expectNotFound } from '@tests/utils/assertions';

/** Role history: a club's officers and full admins read it; a committee lead sees none of it. */
describe('role history', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const query = (input: Record<string, unknown> = {}) =>
    roleHistoryQuerySchema.parse({ pageSize: 100, ...input });

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
    ]);

    // Two changes in club A and one in club B, so the scopes have something to separate.
    await setMemberClubRole(admin, s.memberships.memberA1, 'CLUB_OFFICER');
    await setMemberCommitteeRole(officerA, s.memberships.memberA2, s.committees.a2.id, 'LEAD');
    await setMemberClubRole(admin, s.memberships.memberB1, 'CLUB_OFFICER');
  });

  it('describes each change with exactly the contract fields', async () => {
    const page = await listRoleHistory(admin, s.clubA.id, query());
    expect(page.total).toBe(2);
    for (const item of page.items) {
      roleChangeSchema.parse(item);
      expect(Object.keys(item).sort()).toEqual(Object.keys(roleChangeSchema.shape).sort());
      expect(item.clubId).toBe(s.clubA.id);
    }

    // Newest first.
    expect(page.items[0]).toMatchObject({
      committee: { id: s.committees.a2.id, name: s.committees.a2.name },
      member: { memberId: s.memberships.memberA2, fullName: s.users.memberA2.fullName },
      changedBy: { userId: s.users.officerA.id, fullName: s.users.officerA.fullName },
      previousRole: 'MEMBER',
      newRole: 'LEAD',
    });
    expect(page.items[1]).toMatchObject({
      committee: null,
      member: { memberId: s.memberships.memberA1 },
      changedBy: { userId: s.users.admin.id },
      previousRole: 'MEMBER',
      newRole: 'CLUB_OFFICER',
    });
  });

  it('gives a full admin every club’s history, one club at a time', async () => {
    await expect(listRoleHistory(admin, s.clubB.id, query())).resolves.toMatchObject({
      total: 1,
      items: [{ member: { memberId: s.memberships.memberB1 }, newRole: 'CLUB_OFFICER' }],
    });
  });

  it('gives an officer their own club only', async () => {
    const page = await listRoleHistory(officerA, s.clubA.id, query());
    expect(page.total).toBe(2);
    // Club B is invisible to them: a 404, not an empty page.
    await expectNotFound(listRoleHistory(officerA, s.clubB.id, query()));
    await expectNotFound(listRoleHistory(officerB, s.clubA.id, query()));
  });

  it('shows a committee lead nothing, even for the club they work in', async () => {
    await expectForbidden(listRoleHistory(leadA1, s.clubA.id, query()), 'club_management_required');
    // A plain member cannot even see the club.
    await expectNotFound(listRoleHistory(plain, s.clubA.id, query()));
  });

  it('paginates newest first', async () => {
    const first = await listRoleHistory(admin, s.clubA.id, query({ page: 1, pageSize: 1 }));
    expect(first).toMatchObject({ total: 2, pageCount: 2, items: [{ newRole: 'LEAD' }] });
    const second = await listRoleHistory(admin, s.clubA.id, query({ page: 2, pageSize: 1 }));
    expect(second.items).toMatchObject([{ newRole: 'CLUB_OFFICER' }]);
  });

  it('keeps the history of a member who was removed from the club', async () => {
    const before = await listRoleHistory(admin, s.clubA.id, query());
    await db.membership.update({
      where: { id: s.memberships.memberA1 },
      data: { removedAt: new Date(), role: 'MEMBER' },
    });
    const after = await listRoleHistory(admin, s.clubA.id, query());
    expect(after.total).toBe(before.total);
    await db.membership.update({
      where: { id: s.memberships.memberA1 },
      data: { removedAt: null, role: 'CLUB_OFFICER' },
    });
  });

  /** Who currently holds which role, for the screen that offers to change them. */
  describe('the club’s current role holders', () => {
    it('lists the club’s active officers and the leads of its committees', async () => {
      const permissions = await getClubPermissions(officerA, s.clubA.id);
      expect(permissions.officers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ memberId: s.memberships.officerA }),
          expect.objectContaining({ memberId: s.memberships.mixedA }),
        ]),
      );
      expect(permissions.leads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            memberId: s.memberships.leadA1,
            userId: s.users.leadA1.id,
            fullName: s.users.leadA1.fullName,
            committee: { id: s.committees.a1.id, name: s.committees.a1.name },
          }),
          expect.objectContaining({ memberId: s.memberships.coLeadA1 }),
        ]),
      );
      // The removed officer and the stale lead hold nothing.
      const everyone = [...permissions.officers, ...permissions.leads].map((row) => row.memberId);
      expect(everyone).not.toContain(s.memberships.removedOfficer);
      expect(everyone).not.toContain(s.memberships.staleLead);
    });

    it('follows the same rules as the history', async () => {
      // Club B's own officer, plus the one this file appointed above.
      const clubB = await getClubPermissions(admin, s.clubB.id);
      expect(clubB.officers.map((officer) => officer.memberId).sort()).toEqual(
        [s.memberships.officerB, s.memberships.memberB1].sort(),
      );
      expect(clubB.leads).toEqual([]);
      await expectForbidden(getClubPermissions(leadA1, s.clubA.id), 'club_management_required');
      await expectNotFound(getClubPermissions(officerB, s.clubA.id));
    });
  });
});
