import { beforeAll, describe, expect, it } from 'vitest';

import { listMembers } from '@/modules/members/server';
import { db } from '@/server/db/client';
import { actorFor, buildScenario, membersQuery, type Scenario } from '@tests/factories/scenario';

describe('member search by phone', () => {
  let s: Scenario;
  let stored: string; // E.164, e.g. +966500000002

  beforeAll(async () => {
    s = await buildScenario();
    const membership = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.officerA },
    });
    stored = membership.phone ?? '';
  });

  // The ways people actually type a Saudi number.
  const typed = (phone: string) => {
    const local = `0${phone.slice(4)}`; // 05XXXXXXXX
    return [
      local,
      `+966 ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`,
      `00${phone.slice(1)}`,
      local.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit))), // ٠٥…
    ];
  };

  it('finds the member however the number is typed', async () => {
    const officerA = await actorFor(s.users.officerA.id);
    for (const q of typed(stored)) {
      const page = await listMembers(officerA, membersQuery({ q }));
      expect(
        page.items.map((member) => member.id),
        q,
      ).toEqual([s.memberships.officerA]);
    }
  });
});
