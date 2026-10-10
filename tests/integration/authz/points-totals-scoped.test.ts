import { beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { getMember, listMembers } from '@/server/modules/members';
import { dateOnlyToDate } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  membersQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';

/**
 * A member's points total only counts committees the caller can see. leadA1 leads A1 and is a
 * plain member of A2; give them points in both and look at their total as the lead and as an
 * officer of the club.
 */
describe('points totals follow the nested scope', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
    const add = (committeeMembershipId: string, committee: { id: string }, amount: number) =>
      db.pointTransaction.create({
        data: {
          committeeMembershipId,
          committeeId: committee.id,
          clubId: s.clubA.id,
          amount,
          reason: 'نقاط',
          workDate: dateOnlyToDate(today()),
          createdById: s.users.officerA.id,
        },
      });
    await add(s.committeeMemberships.leadA1, s.committees.a1, 4);
    await add(s.committeeMemberships.leadA1InA2, s.committees.a2, 50);
  });

  it('a lead sees only its own committee’s share, by id and in the list', async () => {
    const lead = await actorFor(s.users.leadA1.id);
    await expect(getMember(lead, s.memberships.leadA1)).resolves.toMatchObject({ points: 4 });
    const page = await listMembers(lead, membersQuery());
    expect(page.items.find((member) => member.id === s.memberships.leadA1)?.points).toBe(4);
  });

  it('an officer of the club sees every committee’s share', async () => {
    const officer = await actorFor(s.users.officerA.id);
    await expect(getMember(officer, s.memberships.leadA1)).resolves.toMatchObject({ points: 54 });
  });
});
