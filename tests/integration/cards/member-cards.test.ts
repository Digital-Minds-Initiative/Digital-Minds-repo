import { beforeAll, describe, expect, it } from 'vitest';

import { type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  awardSticker,
  getMyCardExtras,
  getPublicCard,
  listMemberStickers,
  placeMyStickers,
  renewMyCardLink,
  revokeSticker,
  updateMyCardChoices,
  type CardFacts,
} from '@/server/modules/cards';
import { deletePerson } from '@/server/modules/deletions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/*
 * The member's card (docs/adr/0032-card-link-and-stickers.md): who may change it, who may award a
 * sticker and which, and what the page behind the QR may show — each with the error AND the proof
 * that the database did not change. The people are the shared scenario (tests/factories/scenario.ts).
 */
describe('member cards', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;
  let memberA2: Actor;
  let plain: Actor;

  const factsFor = (actor: Actor, membershipId: string, points = 0): CardFacts => {
    const held = actor.memberships.find((m) => m.membershipId === membershipId);
    return {
      membershipId,
      clubRole: held?.role ?? 'MEMBER',
      ledCommittees: [],
      points,
      transactions: points > 0 ? 1 : 0,
    };
  };
  const tokenOf = (url: string | null) => url?.split('/c/')[1] ?? '';
  const myCard = async (actor: Actor, membershipId: string) => {
    const extras = await getMyCardExtras(actor, [factsFor(actor, membershipId)]);
    const card = extras.get(membershipId);
    if (!card) throw new Error('No card.');
    return card;
  };

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1, memberA2, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
      actorFor(s.users.memberA2.id),
      actorFor(s.users.plain.id),
    ]);
  });

  describe('the card row', () => {
    it('is made the first time it is read, with a link of its own, and is the same the second time', async () => {
      const first = await myCard(memberA1, s.memberships.memberA1);
      const second = await myCard(memberA1, s.memberships.memberA1);
      expect(first.share.url).toMatch(/\/c\/[A-Za-z0-9_-]{32}$/);
      expect(second.share.url).toBe(first.share.url);
      expect(await db.memberCard.count({ where: { membershipId: s.memberships.memberA1 } })).toBe(
        1,
      );
    });

    it('gives two people two different links', async () => {
      const a = await myCard(memberA1, s.memberships.memberA1);
      const b = await myCard(memberA2, s.memberships.memberA2);
      expect(tokenOf(a.share.url)).not.toBe(tokenOf(b.share.url));
    });

    it('keeps only a hash and an encrypted copy of the token, never the token', async () => {
      const card = await myCard(plain, s.memberships.plain);
      const row = await db.memberCard.findUniqueOrThrow({
        where: { membershipId: s.memberships.plain },
      });
      const token = tokenOf(card.share.url);
      expect(row.shareTokenHash).not.toContain(token);
      expect(Buffer.from(row.shareTokenCipher).toString('utf8')).not.toContain(token);
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('defaults to sharing the total but not the reasons behind it', async () => {
      const card = await myCard(memberA1, s.memberships.memberA1);
      expect(card.share).toMatchObject({ enabled: true, showPoints: true, showActivity: false });
    });
  });

  describe("a member's own choices", () => {
    it('change the colour and the sharing of their own card', async () => {
      await myCard(memberA1, s.memberships.memberA1);
      await updateMyCardChoices(memberA1, s.memberships.memberA1, {
        tone: 'matte',
        share: { showActivity: true },
      });
      const card = await myCard(memberA1, s.memberships.memberA1);
      expect(card).toMatchObject({ tone: 'matte', tonePreference: 'matte' });
      expect(card.share.showActivity).toBe(true);
      await updateMyCardChoices(memberA1, s.memberships.memberA1, { tone: null });
      expect((await myCard(memberA1, s.memberships.memberA1)).tonePreference).toBeNull();
    });

    it("refuse someone else's card with a 404, and leave it as it was", async () => {
      const before = await db.memberCard.findUniqueOrThrow({
        where: { membershipId: s.memberships.memberA1 },
      });
      await expectNotFound(
        updateMyCardChoices(officerA, s.memberships.memberA1, { tone: 'paper' }),
      );
      await expectNotFound(placeMyStickers(officerA, s.memberships.memberA1, []));
      await expectNotFound(renewMyCardLink(officerA, s.memberships.memberA1));
      const after = await db.memberCard.findUniqueOrThrow({
        where: { membershipId: s.memberships.memberA1 },
      });
      expect(after).toEqual(before);
    });

    it('renewing the link changes the token at once', async () => {
      const before = await myCard(memberA2, s.memberships.memberA2);
      await renewMyCardLink(memberA2, s.memberships.memberA2);
      const after = await myCard(memberA2, s.memberships.memberA2);
      expect(tokenOf(after.share.url)).not.toBe(tokenOf(before.share.url));
      await expectNotFound(getPublicCard(tokenOf(before.share.url), { ip: null }));
      expect((await getPublicCard(tokenOf(after.share.url), { ip: null })).fullName).toBe(
        s.users.memberA2.fullName,
      );
    });
  });

  describe('where the stickers lie', () => {
    it('replace the layout: what is listed is placed, what is left out comes off', async () => {
      await myCard(officerA, s.memberships.officerA);
      const place = (key: 'lead', x: number) => ({ key, x, y: 0.4, rotation: 5, scale: 1, z: 0 });
      await placeMyStickers(officerA, s.memberships.officerA, [place('lead', 0.3)]);
      expect((await myCard(officerA, s.memberships.officerA)).stickers[0]?.placement?.x).toBe(0.3);
      await placeMyStickers(officerA, s.memberships.officerA, [place('lead', 0.7)]);
      expect(
        await db.badgePlacement.count({
          where: { card: { membershipId: s.memberships.officerA } },
        }),
      ).toBe(1);
      await placeMyStickers(officerA, s.memberships.officerA, []);
      expect(
        await db.badgePlacement.count({
          where: { card: { membershipId: s.memberships.officerA } },
        }),
      ).toBe(0);
    });

    it('the database itself refuses a sticker off the card or far too big', async () => {
      const card = await db.memberCard.findUniqueOrThrow({
        where: { membershipId: s.memberships.officerA },
      });
      for (const bad of [{ x: 1.5 }, { y: -0.1 }, { scale: 9 }, { rotation: 120 }]) {
        await expect(
          db.badgePlacement.create({
            data: {
              cardId: card.id,
              badgeKey: 'lead',
              x: 0.5,
              y: 0.5,
              rotation: 0,
              scale: 1,
              z: 0,
              ...bad,
            },
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe('awarding', () => {
    it('lets a club officer give a member of their club a sticker, once', async () => {
      await awardSticker(officerA, s.memberships.memberA1, 'star');
      await awardSticker(officerA, s.memberships.memberA1, 'star');
      expect(
        await db.badgeAward.count({
          where: { membershipId: s.memberships.memberA1, badgeKey: 'star' },
        }),
      ).toBe(1);
      const award = await db.badgeAward.findFirstOrThrow({
        where: { membershipId: s.memberships.memberA1 },
      });
      expect(award.awardedById).toBe(s.users.officerA.id);
      expect((await myCard(memberA1, s.memberships.memberA1)).stickers.map((x) => x.key)).toContain(
        'star',
      );
    });

    it('lets a committee lead award a member of that committee, but not the founder sticker', async () => {
      await awardSticker(leadA1, s.memberships.memberA1, 'workshop');
      await expectForbidden(
        awardSticker(leadA1, s.memberships.memberA1, 'founder'),
        'sticker_award_not_allowed',
      );
      expect(await db.badgeAward.count({ where: { badgeKey: 'founder' } })).toBe(0);
      const listing = await listMemberStickers(leadA1, s.memberships.memberA1);
      expect(listing.awardable).not.toContain('founder');
    });

    it('lets an officer give the founder sticker', async () => {
      await awardSticker(officerA, s.memberships.plain, 'founder');
      expect(
        await db.badgeAward.count({
          where: { membershipId: s.memberships.plain, badgeKey: 'founder' },
        }),
      ).toBe(1);
    });

    it('keeps a lead out of a member who is not in their committee: a 404 that changes nothing', async () => {
      const before = await db.badgeAward.count();
      await expectNotFound(awardSticker(leadA1, s.memberships.memberA2, 'star'));
      expect(await db.badgeAward.count()).toBe(before);
    });

    it("keeps another club's officer out: a 404 that changes nothing", async () => {
      const before = await db.badgeAward.count();
      await expectNotFound(awardSticker(officerB, s.memberships.memberA1, 'star'));
      expect(await db.badgeAward.count()).toBe(before);
    });

    it('keeps a plain member from awarding anyone', async () => {
      const before = await db.badgeAward.count();
      await expectNotFound(awardSticker(plain, s.memberships.memberA1, 'star'));
      expect(await db.badgeAward.count()).toBe(before);
    });

    it('keeps an officer from awarding themselves, but not a full admin', async () => {
      await expectForbidden(
        awardSticker(officerA, s.memberships.officerA, 'star'),
        'cannot_award_self',
      );
      expect(await db.badgeAward.count({ where: { membershipId: s.memberships.officerA } })).toBe(
        0,
      );
      const adminMembership = admin.memberships[0];
      expect(adminMembership).toBeUndefined(); // the admin holds no membership, so there is nothing to award themselves
    });

    it('refuses a removed member and an archived club with their own reasons', async () => {
      await expectConflict(
        awardSticker(officerA, s.memberships.removedOfficer, 'star'),
        'member_removed',
      );
    });

    it('takes an awarded sticker back, and its place on the card with it', async () => {
      await awardSticker(officerA, s.memberships.memberA2, 'kind');
      await myCard(memberA2, s.memberships.memberA2);
      await placeMyStickers(memberA2, s.memberships.memberA2, [
        { key: 'kind', x: 0.5, y: 0.5, rotation: 0, scale: 1, z: 0 },
      ]);
      expect(await db.badgePlacement.count({ where: { badgeKey: 'kind' } })).toBe(1);
      await revokeSticker(officerA, s.memberships.memberA2, 'kind');
      expect(
        await db.badgeAward.count({
          where: { membershipId: s.memberships.memberA2, badgeKey: 'kind' },
        }),
      ).toBe(0);
      expect(await db.badgePlacement.count({ where: { badgeKey: 'kind' } })).toBe(0);
      await expectNotFound(revokeSticker(officerA, s.memberships.memberA2, 'kind'));
    });
  });

  describe('the page behind the QR', () => {
    it('shows the member, their total and six months, and no contact detail', async () => {
      const card = await myCard(memberA1, s.memberships.memberA1);
      const page = await getPublicCard(tokenOf(card.share.url), { ip: null });
      expect(page).toMatchObject({ fullName: s.users.memberA1.fullName, points: 10 });
      expect(page.monthly).toHaveLength(6);
      expect(JSON.stringify(page)).not.toMatch(/@|\+966/);
    });

    it('answers the same 404 to a token nobody holds', async () => {
      await expectNotFound(getPublicCard('x'.repeat(32), { ip: null }));
    });

    it('holds back points and reasons when the member keeps them private', async () => {
      await updateMyCardChoices(memberA1, s.memberships.memberA1, {
        share: { showPoints: false, showActivity: true },
      });
      const card = await myCard(memberA1, s.memberships.memberA1);
      const page = await getPublicCard(tokenOf(card.share.url), { ip: null });
      expect(page).toMatchObject({ points: null, monthly: null, thisMonth: null, activity: null });
      await updateMyCardChoices(memberA1, s.memberships.memberA1, { share: { showPoints: true } });
    });

    it('is dead when sharing is switched off', async () => {
      const card = await myCard(plain, s.memberships.plain);
      await updateMyCardChoices(plain, s.memberships.plain, { share: { enabled: false } });
      await expectNotFound(getPublicCard(tokenOf(card.share.url), { ip: null }));
      expect((await myCard(plain, s.memberships.plain)).share.url).toBeNull();
      await updateMyCardChoices(plain, s.memberships.plain, { share: { enabled: true } });
    });

    it('is dead for a member who was removed from the club', async () => {
      const row = await db.memberCard.findFirst({
        where: { membershipId: s.memberships.removedOfficer },
      });
      expect(row).toBeNull(); // a removed member never opened their card, so there is no link at all
    });
  });

  describe("a full admin's delete of a person", () => {
    it('takes the card, its placements and its awards with the memberships', async () => {
      await myCard(memberA2, s.memberships.memberA2);
      await awardSticker(officerA, s.memberships.memberA2, 'hack');
      expect(await db.memberCard.count({ where: { membershipId: s.memberships.memberA2 } })).toBe(
        1,
      );
      await deletePerson(admin, s.memberships.memberA2, { uniEmail: s.users.memberA2.uniEmail });
      expect(await db.memberCard.count({ where: { membershipId: s.memberships.memberA2 } })).toBe(
        0,
      );
      expect(await db.badgeAward.count({ where: { membershipId: s.memberships.memberA2 } })).toBe(
        0,
      );
      expect(await db.membership.count({ where: { id: s.memberships.memberA2 } })).toBe(0);
    });
  });
});
