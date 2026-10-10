import { beforeAll, describe, expect, it } from 'vitest';

import { getMe } from '@/modules/auth/server';
import { createMember, getMember, listMembers, removeMember } from '@/modules/members/server';
import { createPointTransaction, getMemberPoints } from '@/modules/points/server';
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
import { expectNotFound } from '@tests/utils/assertions';

/** A removed membership grants nothing — even with a stale role left on the row. */
describe('removed memberships', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
  });

  it('a removed officer (role still stored on the removed row) has no scope at all', async () => {
    const actor = await actorFor(s.users.removedOfficer.id);
    expect(actor.memberships).toEqual([]);
    expect((await listMembers(actor, membersQuery({ status: 'all' }))).total).toBe(0);
    await expectNotFound(getMember(actor, s.memberships.memberA1));
    await expectNotFound(
      createPointTransaction(actor, {
        memberId: s.memberships.memberA1,
        committeeId: s.committees.a1.id,
        amount: 10,
        reason: 'محاولة',
        workDate: today(),
      }),
    );
    const me = await getMe(actor);
    expect(me.access).toMatchObject({ canAccessDashboard: false, clubs: [], committees: [] });
  });

  it('a removed committee membership with a stale LEAD role grants no lead scope', async () => {
    const actor = await actorFor(s.users.staleLead.id);
    expect(actor.memberships[0]?.committees).toEqual([]);
    expect((await listMembers(actor, membersQuery())).total).toBe(0);
    await expectNotFound(getMemberPoints(actor, s.memberships.memberA1, pointsQuery()));
  });

  describe('removing someone from a club', () => {
    let officerA: Actor;

    beforeAll(async () => {
      officerA = await actorFor(s.users.officerA.id);
    });

    it('removes only that club membership; account, other clubs and points history stay', async () => {
      const pointsBefore = await db.pointTransaction.count({
        where: { committeeMembership: { membershipId: s.memberships.bothClubsA } },
      });

      await removeMember(officerA, s.memberships.bothClubsA);

      const membershipA = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.bothClubsA },
        include: { committeeMemberships: true },
      });
      expect(membershipA.removedAt).not.toBeNull();
      expect(
        membershipA.committeeMemberships.every((committee) => committee.removedAt !== null),
      ).toBe(true);

      const membershipB = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.bothClubsB },
      });
      expect(membershipB.removedAt).toBeNull();
      await expect(
        db.user.findUniqueOrThrow({ where: { id: s.users.bothClubs.id } }),
      ).resolves.toBeTruthy();

      const pointsAfter = await db.pointTransaction.count({
        where: {
          committeeMembership: { membershipId: s.memberships.bothClubsA },
          status: 'ACTIVE',
        },
      });
      expect(pointsAfter).toBe(pointsBefore);
    });

    it('takes away a removed lead’s rights immediately and does not restore them on re-adding', async () => {
      await removeMember(officerA, s.memberships.coLeadA1);
      const formerLead = await actorFor(s.users.coLeadA1.id);
      expect(formerLead.memberships).toEqual([]);
      expect((await listMembers(formerLead, membersQuery())).total).toBe(0);

      const readded = await createMember(officerA, {
        clubId: s.clubA.id,
        person: { uniEmail: s.users.coLeadA1.uniEmail, fullName: s.users.coLeadA1.fullName },
        profile: {},
        committeeIds: [s.committees.a1.id],
      });
      expect(readded.id).toBe(s.memberships.coLeadA1);
      expect(readded.role).toBe('MEMBER');
      expect(readded.committees).toEqual([
        expect.objectContaining({ id: s.committees.a1.id, role: 'MEMBER' }),
      ]);
    });
  });
});
