import { beforeAll, describe, expect, it } from 'vitest';

import { type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  awardSticker,
  changeSticker,
  createSticker,
  getMyCardExtras,
  getPublicCard,
  listCustomStickers,
  listMemberStickers,
  revokeSticker,
  updateMyCardChoices,
  type CardFacts,
} from '@/server/modules/cards';
import type { CustomStickerFields } from '@/shared/contracts/stickers';
import { CUSTOM_STICKER_LIMITS, customStickerKey } from '@/shared/lib/stickers';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/*
 * The sticker studio (docs/adr/0033-custom-stickers.md): who may design, change and give the
 * stickers a club's leaders make, what a hidden one shows, and what the public page may carry —
 * each refusal with the proof that the database did not change.
 */
const design = (over: Partial<CustomStickerFields> = {}): CustomStickerFields => ({
  name: 'بطل الهاكاثون',
  howTo: 'يقود فريقه للفوز في هاكاثون النادي',
  label: 'بطل',
  icon: 'trophy',
  shape: 'shield',
  background: 'indigo',
  ink: 'white',
  hidden: false,
  awardableBy: 'LEAD',
  rarity: 'COMMON',
  availableFrom: null,
  availableUntil: null,
  maxHolders: null,
  ...over,
});

describe('custom stickers', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;
  let memberA2: Actor;

  const factsFor = (actor: Actor, membershipId: string): CardFacts => ({
    membershipId,
    clubRole: actor.memberships.find((m) => m.membershipId === membershipId)?.role ?? 'MEMBER',
    ledCommittees: [],
    points: 0,
    transactions: 0,
  });
  const cardOf = async (actor: Actor, membershipId: string) => {
    const card = (await getMyCardExtras(actor, [factsFor(actor, membershipId)])).get(membershipId);
    if (!card) throw new Error('No card.');
    return card;
  };

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1, memberA2] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
      actorFor(s.users.memberA2.id),
    ]);
  });

  describe('designing', () => {
    it('lets a lead, an officer and a full admin make one, and records who', async () => {
      const byLead = await createSticker(leadA1, s.clubA.id, design({ name: 'من القائد' }));
      const byOfficer = await createSticker(officerA, s.clubA.id, design({ name: 'من المسؤول' }));
      const byAdmin = await createSticker(admin, s.clubA.id, design({ name: 'من المدير' }));
      expect([byLead.canEdit, byOfficer.canEdit, byAdmin.canEdit]).toEqual([true, true, true]);
      const row = await db.customSticker.findUniqueOrThrow({ where: { id: byLead.id } });
      expect(row).toMatchObject({ clubId: s.clubA.id, createdById: s.users.leadA1.id });
      expect(byLead.key).toBe(customStickerKey(byLead.id));
    });

    it('shows a plain member nothing of the studio, nor an outsider another club’s', async () => {
      const before = await db.customSticker.count();
      await expectNotFound(createSticker(memberA1, s.clubA.id, design()));
      await expectNotFound(listCustomStickers(memberA1, s.clubA.id));
      await expectNotFound(createSticker(officerB, s.clubA.id, design()));
      await expectNotFound(listCustomStickers(officerB, s.clubA.id));
      expect(await db.customSticker.count()).toBe(before);
    });

    it('refuses a club that is full, and does not make the extra one', async () => {
      const live = await db.customSticker.count({ where: { clubId: s.clubB.id } });
      for (let i = live; i < CUSTOM_STICKER_LIMITS.perClub; i++) {
        await createSticker(officerB, s.clubB.id, design({ name: `ملصق ${i}` }));
      }
      await expectConflict(
        createSticker(officerB, s.clubB.id, design({ name: 'زيادة' })),
        'sticker_limit_reached',
      );
      expect(await db.customSticker.count({ where: { clubId: s.clubB.id } })).toBe(
        CUSTOM_STICKER_LIMITS.perClub,
      );
    });

    it('lets the maker and the officers change a sticker, and nobody else', async () => {
      const made = await createSticker(leadA1, s.clubA.id, design({ name: 'قبل' }));
      await expect(changeSticker(leadA1, made.id, { name: 'بعد' })).resolves.toMatchObject({
        name: 'بعد',
      });
      await expect(changeSticker(officerA, made.id, { hidden: true })).resolves.toMatchObject({
        hidden: true,
      });
      await expectNotFound(changeSticker(memberA1, made.id, { name: 'خطف' }));
      await expectNotFound(changeSticker(officerB, made.id, { name: 'خطف' }));
      expect((await db.customSticker.findUniqueOrThrow({ where: { id: made.id } })).name).toBe(
        'بعد',
      );
    });

    it('refuses a colour or an icon that is not in the design system', async () => {
      const { customStickerFieldsSchema } = await import('@/shared/contracts/stickers');
      expect(
        customStickerFieldsSchema.safeParse(design({ background: 'url(x)' as never })).success,
      ).toBe(false);
      expect(customStickerFieldsSchema.safeParse(design({ icon: 'skull' as never })).success).toBe(
        false,
      );
      expect(customStickerFieldsSchema.safeParse({ ...design(), css: 'x' }).success).toBe(false);
    });
  });

  describe('giving', () => {
    it('lets the lead of the member’s committee give it, with a reason that the member sees', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'يُمنح بالسبب' }));
      const key = customStickerKey(made.id);
      await awardSticker(leadA1, s.memberships.memberA1, key, 'قاد الفريق بدون ما نطلب');
      const row = await db.badgeAward.findUniqueOrThrow({
        where: {
          membershipId_badgeKey: { membershipId: s.memberships.memberA1, badgeKey: key },
        },
      });
      expect(row.reason).toBe('قاد الفريق بدون ما نطلب');

      const card = await cardOf(memberA1, s.memberships.memberA1);
      const held = card.stickers.find((sticker) => sticker.key === key);
      expect(held).toMatchObject({
        source: 'awarded',
        reason: 'قاد الفريق بدون ما نطلب',
        custom: { name: 'يُمنح بالسبب', shape: 'shield', hidden: false },
      });
      expect(held?.earnedAt).not.toBeNull();
      // Once held, it is no longer in the locked part of the tray.
      expect(card.lockedStickers.some((def) => def.key === key)).toBe(false);
    });

    it('keeps the reason off the public page unless the member shows their activity', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'سبب خاص' }));
      const key = customStickerKey(made.id);
      await awardSticker(officerA, s.memberships.memberA2, key, 'ملاحظة داخلية');
      const own = await cardOf(memberA2, s.memberships.memberA2);
      const token = own.share.url?.split('/c/')[1] ?? '';

      const hidden = await getPublicCard(token, { ip: '203.0.113.9' });
      expect(hidden.stickers.find((sticker) => sticker.key === key)).toMatchObject({
        reason: null,
        custom: { name: 'سبب خاص' },
      });
      await updateMyCardChoices(memberA2, s.memberships.memberA2, {
        share: { showActivity: true },
      });
      const shown = await getPublicCard(token, { ip: '203.0.113.9' });
      expect(shown.stickers.find((sticker) => sticker.key === key)?.reason).toBe('ملاحظة داخلية');
    });

    it('refuses a lead a sticker made for officers only, and nobody gives themselves one', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ awardableBy: 'OFFICER' }));
      const key = customStickerKey(made.id);
      const before = await db.badgeAward.count();
      await expectForbidden(
        awardSticker(leadA1, s.memberships.memberA1, key),
        'sticker_award_not_allowed',
      );
      await expectForbidden(awardSticker(leadA1, s.memberships.leadA1, key), 'cannot_award_self');
      expect(await db.badgeAward.count()).toBe(before);
      const offered = await listMemberStickers(leadA1, s.memberships.memberA1);
      expect(offered.awardable).not.toContain(key);
      const officerOffered = await listMemberStickers(officerA, s.memberships.memberA1);
      expect(officerOffered.awardable).toContain(key);
      expect(officerOffered.custom.some((def) => def.key === key)).toBe(true);
    });

    it('does not reach a member of a committee the lead does not lead', async () => {
      const made = await createSticker(officerA, s.clubA.id, design());
      await expectNotFound(awardSticker(leadA1, s.memberships.memberA2, customStickerKey(made.id)));
    });

    it('refuses another club’s sticker, an unknown one and an archived one, changing nothing', async () => {
      // Club B's stickers exist by now (the limit test filled them): none may be given in club A.
      const foreign = await db.customSticker.findFirstOrThrow({ where: { clubId: s.clubB.id } });
      const before = await db.badgeAward.count();
      await expectNotFound(
        awardSticker(officerA, s.memberships.memberA1, customStickerKey(foreign.id)),
      );
      await expectNotFound(
        awardSticker(
          officerA,
          s.memberships.memberA1,
          'custom:00000000-0000-4000-8000-000000000000',
        ),
      );
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'سيؤرشف' }));
      await changeSticker(officerA, made.id, { archived: true });
      await expectConflict(
        awardSticker(officerA, s.memberships.memberA1, customStickerKey(made.id)),
        'sticker_archived',
      );
      expect(await db.badgeAward.count()).toBe(before);
    });

    it('lets an archived sticker stay on the card that holds it', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'يبقى' }));
      const key = customStickerKey(made.id);
      await awardSticker(officerA, s.memberships.memberA1, key);
      await changeSticker(officerA, made.id, { archived: true });
      const card = await cardOf(memberA1, s.memberships.memberA1);
      expect(card.stickers.some((sticker) => sticker.key === key)).toBe(true);
    });

    it('takes a custom sticker back, and its place on the card with it', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'يُسحب' }));
      const key = customStickerKey(made.id);
      await awardSticker(officerA, s.memberships.memberA1, key);
      await revokeSticker(officerA, s.memberships.memberA1, key);
      expect(
        await db.badgeAward.count({
          where: { membershipId: s.memberships.memberA1, badgeKey: key },
        }),
      ).toBe(0);
      await expectNotFound(revokeSticker(officerA, s.memberships.memberA1, key));
    });
  });

  describe('hidden stickers', () => {
    it('are not shown locked to a member, and appear once given', async () => {
      const made = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'سرّي جداً', hidden: true }),
      );
      const key = customStickerKey(made.id);
      const before = await cardOf(memberA1, s.memberships.memberA1);
      expect(before.lockedStickers.some((def) => def.key === key)).toBe(false);
      expect(before.stickers.some((sticker) => sticker.key === key)).toBe(false);
      await awardSticker(officerA, s.memberships.memberA1, key);
      const after = await cardOf(memberA1, s.memberships.memberA1);
      expect(after.stickers.find((sticker) => sticker.key === key)?.custom?.hidden).toBe(true);
    });

    it('include a built-in one only officers give', async () => {
      await expectForbidden(
        awardSticker(leadA1, s.memberships.memberA1, 'legend'),
        'sticker_award_not_allowed',
      );
      await awardSticker(officerA, s.memberships.memberA1, 'legend', 'لأنه أسطورة');
      const card = await cardOf(memberA1, s.memberships.memberA1);
      expect(card.stickers.find((sticker) => sticker.key === 'legend')).toMatchObject({
        source: 'awarded',
        reason: 'لأنه أسطورة',
      });
    });
  });
});
