import { beforeAll, describe, expect, it } from 'vitest';

import { getMe } from '@/modules/auth/server';
import { getMember, listMembers } from '@/modules/members/server';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
} from '@/modules/points/server';
import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  actorFor,
  buildScenario,
  membersQuery,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';

/** A full admin sees and manages everything in every club. */
describe('full admin', () => {
  let s: Scenario;
  let admin: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    admin = await actorFor(s.users.admin.id);
  });

  it('lists every membership in every club', async () => {
    const page = await listMembers(admin, membersQuery({ status: 'all' }));
    expect(page.total).toBe(await db.membership.count());
    expect(new Set(page.items.map((member) => member.club.id))).toEqual(
      new Set([s.clubA.id, s.clubB.id]),
    );
  });

  it('reads members and full points history in any club', async () => {
    await expect(getMember(admin, s.memberships.memberB1)).resolves.toMatchObject({ points: 30 });
    const history = await getMemberPoints(admin, s.memberships.bothClubsA, pointsQuery());
    expect(history.totals.balance).toBe(7);
  });

  it('manages points in any committee', async () => {
    const created = await createPointTransaction(admin, {
      memberId: s.memberships.memberB1,
      committeeId: s.committees.b1.id,
      amount: -3,
      reason: 'تأخر في التسليم',
      workDate: today(),
    });
    await expect(
      cancelPointTransaction(admin, created.id, { reason: 'أضيفت بالخطأ' }),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('can open the dashboard and manage every club', async () => {
    const me = await getMe(admin);
    expect(me.access.canAccessDashboard).toBe(true);
    expect(me.access.canManageClubs).toBe(true);
    expect(me.access.clubs.map((club) => club.id).sort()).toEqual([s.clubA.id, s.clubB.id].sort());
  });
});
