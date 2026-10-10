import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { getMe } from '@/server/modules/auth';
import { getMember, listMembers } from '@/server/modules/members';
import { createPointTransaction } from '@/server/modules/points';
import {
  actorFor,
  buildScenario,
  membersQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectNotFound } from '@tests/utils/assertions';

/** One person who is officer in club A and a plain member in club B gets each club's correct scope. */
describe('officer in one club, member in another', () => {
  let s: Scenario;
  let mixed: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    mixed = await actorFor(s.users.mixed.id);
  });

  it('has officer scope in club A', async () => {
    const page = await listMembers(mixed, membersQuery());
    expect(page.items.map((member) => member.id)).toEqual(
      expect.arrayContaining([s.memberships.memberA1, s.memberships.memberA2, s.memberships.plain]),
    );
    await expect(
      createPointTransaction(mixed, {
        memberId: s.memberships.memberA1,
        committeeId: s.committees.a1.id,
        amount: 10,
        reason: 'مشاركة',
        workDate: today(),
      }),
    ).resolves.toMatchObject({ amount: 10 });
  });

  it('has no management scope in club B, even in the committee they belong to', async () => {
    const page = await listMembers(mixed, membersQuery({ status: 'all' }));
    expect(page.items.every((member) => member.club.id === s.clubA.id)).toBe(true);
    await expectNotFound(getMember(mixed, s.memberships.memberB1));
    await expectNotFound(getMember(mixed, s.memberships.mixedB)); // not even their own B membership
    await expectNotFound(
      createPointTransaction(mixed, {
        memberId: s.memberships.memberB1,
        committeeId: s.committees.b1.id,
        amount: 10,
        reason: 'محاولة',
        workDate: today(),
      }),
    );
  });

  it('sees both memberships as their own, but dashboard access to club A only', async () => {
    const me = await getMe(mixed);
    expect(me.memberships.map((membership) => membership.club.id).sort()).toEqual(
      [s.clubA.id, s.clubB.id].sort(),
    );
    expect(me.access.clubs).toEqual([expect.objectContaining({ id: s.clubA.id, canManage: true })]);
    expect(me.access.committees.every((committee) => committee.clubId === s.clubA.id)).toBe(true);
  });
});
