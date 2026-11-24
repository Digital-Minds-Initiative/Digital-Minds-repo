import { beforeAll, describe, expect, it } from 'vitest';

import { membersScope, ownMembershipsScope, type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { updateMyCardChoices } from '@/server/modules/cards';
import {
  createAward,
  replacePlacements,
  updateCardChoices,
} from '@/server/modules/cards/repository';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';

/*
 * The card repository applies its scope itself (docs/adr/0032-card-link-and-stickers.md): a scope
 * that does not reach the membership changes nothing and says so.
 */
describe('card repository scopes', () => {
  let s: Scenario;
  let officerB: Actor;
  let memberA1: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    [officerB, memberA1] = await Promise.all([
      actorFor(s.users.officerB.id),
      actorFor(s.users.memberA1.id),
    ]);
    // Give the member a card row to aim at.
    await updateMyCardChoices(memberA1, s.memberships.memberA1, { share: { showPoints: true } });
  });

  it('club B reaches nothing of club A', async () => {
    const scopeB = membersScope(officerB);
    const row = () =>
      db.memberCard.findUniqueOrThrow({ where: { membershipId: s.memberships.memberA1 } });
    const before = await row();
    expect(await updateCardChoices(scopeB, s.memberships.memberA1, { tone: 'MATTE' })).toBe(false);
    expect(await replacePlacements(scopeB, s.memberships.memberA1, [])).toBe(false);
    expect(
      await createAward(
        scopeB,
        { membershipId: s.memberships.memberA1, clubId: s.clubA.id },
        'hack',
        s.users.officerB.id,
        new Date(),
      ),
    ).toBeNull();
    expect(await row()).toEqual(before);
    expect(await db.badgeAward.count({ where: { badgeKey: 'hack' } })).toBe(0);
  });

  it('a member’s own scope reaches their own card and nothing else', async () => {
    expect(
      await updateCardChoices(ownMembershipsScope(memberA1), s.memberships.memberA2, {
        tone: 'MATTE',
      }),
    ).toBe(false);
    expect(
      await db.memberCard.count({ where: { membershipId: s.memberships.memberA2, tone: 'MATTE' } }),
    ).toBe(0);
  });
});
