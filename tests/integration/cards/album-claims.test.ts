import { beforeAll, describe, expect, it } from 'vitest';

import { type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  awardSticker,
  buildClubAlbum,
  changeSticker,
  closeClaim,
  createClaim,
  createSticker,
  getClaimCode,
  getStickerStats,
  listClaims,
  redeemClaim,
} from '@/server/modules/cards';
import type { CustomStickerFields } from '@/shared/contracts/stickers';
import { customStickerKey } from '@/shared/lib/stickers';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/*
 * Seasons, caps, the album, event codes and a sticker's numbers
 * (docs/adr/0034-album-claims-and-seasons.md): each refusal with the proof that the database did
 * not change.
 */
const design = (over: Partial<CustomStickerFields> = {}): CustomStickerFields => ({
  name: 'ملصق',
  howTo: 'يُمنح لمن يحضر',
  label: 'حاضر',
  icon: 'mic',
  shape: 'hex',
  background: 'orange',
  ink: 'deep',
  hidden: false,
  awardableBy: 'LEAD',
  rarity: 'RARE',
  availableFrom: null,
  availableUntil: null,
  maxHolders: null,
  ...over,
});

const minutes = (now: Date, n: number) => new Date(now.getTime() + n * 60_000);

describe('album, claims and seasons', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;
  let memberA2: Actor;
  let plain: Actor;
  let memberB1: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1, memberA2, plain, memberB1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
      actorFor(s.users.memberA2.id),
      actorFor(s.users.plain.id),
      actorFor(s.users.memberB1.id),
    ]);
  });

  describe('seasons and caps', () => {
    it('refuses to give a seasonal sticker outside its window, and gives it inside', async () => {
      const now = new Date();
      const past = await createSticker(
        officerA,
        s.clubA.id,
        design({
          name: 'انتهى',
          availableFrom: minutes(now, -120).toISOString(),
          availableUntil: minutes(now, -60).toISOString(),
        }),
      );
      const future = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'لم يبدأ', availableFrom: minutes(now, 60).toISOString() }),
      );
      const open = await createSticker(
        officerA,
        s.clubA.id,
        design({
          name: 'مفتوح',
          availableFrom: minutes(now, -60).toISOString(),
          availableUntil: minutes(now, 60).toISOString(),
        }),
      );
      const before = await db.badgeAward.count();
      await expectConflict(
        awardSticker(officerA, s.memberships.memberA1, customStickerKey(past.id)),
        'sticker_not_available',
      );
      await expectConflict(
        awardSticker(officerA, s.memberships.memberA1, customStickerKey(future.id)),
        'sticker_not_available',
      );
      expect(await db.badgeAward.count()).toBe(before);
      await awardSticker(officerA, s.memberships.memberA1, customStickerKey(open.id));
      expect(await db.badgeAward.count()).toBe(before + 1);
    });

    it('stops at the cap, and one person holding it still counts as one', async () => {
      const made = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'نادر جداً', maxHolders: 1 }),
      );
      const key = customStickerKey(made.id);
      await awardSticker(officerA, s.memberships.memberA1, key);
      // Giving it again to the same person is the same award, not a second place.
      await awardSticker(officerA, s.memberships.memberA1, key);
      await expectConflict(awardSticker(officerA, s.memberships.memberA2, key), 'sticker_sold_out');
      expect(await db.badgeAward.count({ where: { badgeKey: key } })).toBe(1);
    });

    it('lets two people go for the last place without both getting it', async () => {
      const made = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'سباق', maxHolders: 1 }),
      );
      const key = customStickerKey(made.id);
      const results = await Promise.allSettled([
        awardSticker(officerA, s.memberships.memberA1, key),
        awardSticker(officerA, s.memberships.memberA2, key),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.badgeAward.count({ where: { badgeKey: key } })).toBe(1);
    });

    it('refuses a window that ends before it starts', async () => {
      const { customStickerFieldsSchema } = await import('@/shared/contracts/stickers');
      const now = new Date();
      expect(
        customStickerFieldsSchema.safeParse(
          design({
            availableFrom: minutes(now, 60).toISOString(),
            availableUntil: minutes(now, 30).toISOString(),
          }),
        ).success,
      ).toBe(false);
    });
  });

  describe('the album', () => {
    it('lists what the club has, counts a hidden sticker without describing it, and gives a share of holders', async () => {
      const shown = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'ظاهر', rarity: 'LEGENDARY' }),
      );
      const secret = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'خفي', hidden: true }),
      );
      await awardSticker(officerA, s.memberships.memberA2, customStickerKey(shown.id));

      const album = await buildClubAlbum(s.clubA.id, new Set(), new Date());
      const entry = album.entries.find((e) => e.key === customStickerKey(shown.id));
      expect(entry).toMatchObject({ rarity: 'LEGENDARY', held: false, open: true });
      expect(entry?.heldPercent).toBeGreaterThan(0);
      // Nothing of the hidden one leaks: it is only in the count.
      expect(album.entries.some((e) => e.key === customStickerKey(secret.id))).toBe(false);
      expect(JSON.stringify(album)).not.toContain('خفي');
      expect(album.secretCount).toBeGreaterThanOrEqual(2); // the built-in legend and this one

      const mine = await buildClubAlbum(
        s.clubA.id,
        new Set([customStickerKey(secret.id)]),
        new Date(),
      );
      expect(mine.entries.find((e) => e.key === customStickerKey(secret.id))?.held).toBe(true);
    });

    it('marks a sticker that is sold out or in the past as no longer open', async () => {
      const full = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'منتهي الكمية', maxHolders: 1 }),
      );
      await awardSticker(officerA, s.memberships.plain, customStickerKey(full.id));
      const album = await buildClubAlbum(s.clubA.id, new Set(), new Date());
      expect(album.entries.find((e) => e.key === customStickerKey(full.id))?.open).toBe(false);
    });
  });

  describe('event codes', () => {
    const body = (key: string, over: Record<string, unknown> = {}) => ({
      key: key as never,
      title: 'ورشة الأربعاء',
      maxClaims: 2,
      minutes: 60,
      committeeId: null,
      ...over,
    });

    it('lets an officer make a code, whom anyone with the current code can use once', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'حاضر الورشة' }));
      const key = customStickerKey(made.id);
      const claim = await createClaim(officerA, s.clubA.id, body(key));
      expect(claim).toMatchObject({ status: 'open', claimed: 0, maxClaims: 2, key });

      const { code } = await getClaimCode(officerA, claim.id);
      const got = await redeemClaim(memberA1, code);
      expect(got).toMatchObject({ key, title: 'ورشة الأربعاء' });
      const award = await db.badgeAward.findUniqueOrThrow({
        where: { membershipId_badgeKey: { membershipId: s.memberships.memberA1, badgeKey: key } },
      });
      expect(award).toMatchObject({ reason: 'ورشة الأربعاء', awardedById: s.users.officerA.id });

      // Once each, and the count follows.
      await expectConflict(redeemClaim(memberA1, code), 'already_claimed');
      await redeemClaim(memberA2, code);
      await expectConflict(redeemClaim(plain, code), 'claim_full');
      const listed = (await listClaims(officerA, s.clubA.id)).claims.find((c) => c.id === claim.id);
      expect(listed).toMatchObject({ claimed: 2, status: 'full' });
      expect(await db.stickerClaimRedemption.count({ where: { claimId: claim.id } })).toBe(2);
    });

    it('refuses a code that is made up, from another minute too long ago, or from another claim', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'رمز' }));
      const claim = await createClaim(officerA, s.clubA.id, body(customStickerKey(made.id)));
      const now = new Date();
      const { code } = await getClaimCode(officerA, claim.id, now);
      const before = await db.badgeAward.count();

      const [id, window] = code.split('.');
      await expectNotFound(redeemClaim(memberA1, `${id}.${window}.AAAAAAAAAAAAAAAA`));
      // Three minutes later the same code is too old: it answers the same 404 as a wrong one.
      await expectNotFound(redeemClaim(memberA1, code, minutes(now, 3)));
      // One minute later it still works (the minute may have just turned under someone's phone).
      await redeemClaim(memberA1, code, minutes(now, 1));
      expect(await db.badgeAward.count()).toBe(before + 1);
    });

    it('keeps out someone from another club, and a member outside the committee a lead chose', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'للجنة فقط' }));
      const claim = await createClaim(
        leadA1,
        s.clubA.id,
        body(customStickerKey(made.id), { committeeId: s.committees.a1.id }),
      );
      const { code } = await getClaimCode(leadA1, claim.id);
      const before = await db.stickerClaimRedemption.count();
      await expectForbidden(redeemClaim(memberB1, code), 'claim_not_for_you');
      // Member A2 is in committee a2, not a1.
      await expectForbidden(redeemClaim(memberA2, code), 'claim_not_for_you');
      expect(await db.stickerClaimRedemption.count()).toBe(before);
      await redeemClaim(memberA1, code);
    });

    it('holds a lead to their committee and to stickers leads may give', async () => {
      const officerOnly = await createSticker(
        officerA,
        s.clubA.id,
        design({ name: 'للمسؤول', awardableBy: 'OFFICER' }),
      );
      const before = await db.stickerClaim.count();
      await expectForbidden(
        createClaim(
          leadA1,
          s.clubA.id,
          body(customStickerKey(officerOnly.id), { committeeId: s.committees.a1.id }),
        ),
        'sticker_claim_not_allowed',
      );
      await expectForbidden(
        createClaim(leadA1, s.clubA.id, body('star', { committeeId: s.committees.a2.id })),
        'sticker_claim_not_allowed',
      );
      await expectForbidden(
        createClaim(leadA1, s.clubA.id, body('star')),
        'sticker_claim_not_allowed',
      );
      await expectForbidden(
        createClaim(leadA1, s.clubA.id, body('founder', { committeeId: s.committees.a1.id })),
        'sticker_claim_not_allowed',
      );
      await expectNotFound(createClaim(officerB, s.clubA.id, body('star')));
      await expectNotFound(createClaim(memberA1, s.clubA.id, body('star')));
      expect(await db.stickerClaim.count()).toBe(before);
      await createClaim(leadA1, s.clubA.id, body('star', { committeeId: s.committees.a1.id }));
    });

    it('stops a closed or expired code, and refuses a sticker that has since been archived', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'يُغلق' }));
      const key = customStickerKey(made.id);
      const claim = await createClaim(officerA, s.clubA.id, body(key));
      const { code } = await getClaimCode(officerA, claim.id);
      await changeSticker(officerA, made.id, { archived: true });
      await expectConflict(redeemClaim(memberA1, code), 'sticker_archived');
      await changeSticker(officerA, made.id, { archived: false });

      const closed = await closeClaim(officerA, claim.id);
      expect(closed.status).toBe('closed');
      await expectConflict(redeemClaim(memberA1, code), 'claim_expired');
      await expectConflict(getClaimCode(officerA, claim.id), 'claim_expired');
      // Closing again changes nothing.
      const row = await db.stickerClaim.findUniqueOrThrow({ where: { id: claim.id } });
      await closeClaim(officerA, claim.id, new Date(Date.now() + 5000));
      expect(
        (await db.stickerClaim.findUniqueOrThrow({ where: { id: claim.id } })).closedAt,
      ).toEqual(row.closedAt);
    });

    it('shows a lead only their own codes, and no one else’s code or screen', async () => {
      const mine = await createClaim(
        leadA1,
        s.clubA.id,
        body('star', { committeeId: s.committees.a1.id, title: 'قائد' }),
      );
      const theirs = await createClaim(officerA, s.clubA.id, body('star', { title: 'مسؤول' }));
      const leadSees = (await listClaims(leadA1, s.clubA.id)).claims.map((c) => c.id);
      expect(leadSees).toContain(mine.id);
      expect(leadSees).not.toContain(theirs.id);
      await expectForbidden(getClaimCode(leadA1, theirs.id), 'sticker_claim_not_allowed');
      await expectForbidden(closeClaim(leadA1, theirs.id), 'sticker_claim_not_allowed');
      await expectNotFound(getClaimCode(officerB, mine.id));
      expect((await listClaims(officerA, s.clubA.id)).claims.map((c) => c.id)).toEqual(
        expect.arrayContaining([mine.id, theirs.id]),
      );
    });

    it('counts attempts, so a flood of wrong codes is slowed', async () => {
      const { RateLimitedError } = await import('@/server/errors');
      const attempts = [];
      for (let i = 0; i < 25; i++) {
        attempts.push(
          redeemClaim(admin, `00000000-0000-4000-8000-000000000000.${i}.AAAAAAAAAAAAAAAA`).catch(
            (error: unknown) => error,
          ),
        );
      }
      const errors = await Promise.all(attempts);
      expect(errors.some((error) => error instanceof RateLimitedError)).toBe(true);
    });
  });

  describe('a sticker’s numbers', () => {
    it('counts holders, placements, months and givers for the people who design stickers', async () => {
      const made = await createSticker(officerA, s.clubA.id, design({ name: 'بالأرقام' }));
      const key = customStickerKey(made.id);
      await awardSticker(officerA, s.memberships.memberA1, key);
      await awardSticker(officerA, s.memberships.memberA2, key);
      const stats = await getStickerStats(leadA1, made.id);
      expect(stats.heldBy).toBe(2);
      expect(stats.percentOfMembers).toBeGreaterThan(0);
      expect(stats.byMonth).toHaveLength(6);
      expect(stats.byMonth.at(-1)?.count).toBe(2);
      expect(stats.givers[0]).toMatchObject({ count: 2 });
      expect(stats.placedPercent).toBe(0);
      await expectNotFound(getStickerStats(memberA1, made.id));
      await expectNotFound(getStickerStats(officerB, made.id));
    });
  });
});
