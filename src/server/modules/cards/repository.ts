import 'server-only';

import type { ClubScope, MemberScope } from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { CardTone, Prisma, StickerAwardBy, StickerRarity } from '@/server/db/generated/client';
import type { StickerRef } from '@/shared/lib/stickers';

/*
 * Prisma access for the member card (docs/adr/0032-card-link-and-stickers.md): the person's own
 * choices, the stickers awarded to them and where they lie. Every read and write of scoped rows
 * takes a MemberScope and ANDs it in; the public page reads through `cardLinkMemberScope`.
 */

const cardSelect = {
  id: true,
  membershipId: true,
  clubId: true,
  tone: true,
  shareEnabled: true,
  showPoints: true,
  showActivity: true,
  shareTokenHash: true,
  shareTokenCipher: true,
  shareTokenCreatedAt: true,
  placements: {
    select: { badgeKey: true, x: true, y: true, rotation: true, scale: true, z: true },
    orderBy: { z: 'asc' },
  },
} satisfies Prisma.MemberCardSelect;

export type CardRow = Prisma.MemberCardGetPayload<{ select: typeof cardSelect }>;

/** The cards of the memberships the scope reaches. */
export async function findCards(scope: MemberScope): Promise<CardRow[]> {
  return db.memberCard.findMany({
    where: { membership: { AND: [scope] } },
    select: cardSelect,
  });
}

/**
 * Makes the cards that do not exist yet, each with a token of its own. `skipDuplicates` so two
 * requests reading the same card for the first time do not collide: one wins and both read it.
 */
export async function createMissingCards(
  rows: Array<{
    membershipId: string;
    clubId: string;
    token: { hash: string; cipher: Uint8Array<ArrayBuffer>; createdAt: Date };
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db.memberCard.createMany({
    data: rows.map((row) => ({
      membershipId: row.membershipId,
      clubId: row.clubId,
      shareTokenHash: row.token.hash,
      shareTokenCipher: row.token.cipher,
      shareTokenCreatedAt: row.token.createdAt,
    })),
    skipDuplicates: true,
  });
}

/** Stickers awarded to the memberships the scope reaches. */
export async function findAwards(
  scope: MemberScope,
): Promise<
  Array<{ membershipId: string; badgeKey: string; awardedAt: Date; reason: string | null }>
> {
  return db.badgeAward.findMany({
    where: { membership: { AND: [scope] } },
    select: { membershipId: true, badgeKey: true, awardedAt: true, reason: true },
  });
}

/** The member's own choices: colour and what the link shows. Only the cards the scope reaches change. */
export async function updateCardChoices(
  scope: MemberScope,
  membershipId: string,
  data: {
    tone?: CardTone | null;
    shareEnabled?: boolean;
    showPoints?: boolean;
    showActivity?: boolean;
  },
): Promise<boolean> {
  const { count } = await db.memberCard.updateMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    data,
  });
  return count === 1;
}

/** A new token for the card: the old one stops working at once. */
export async function replaceCardToken(
  scope: MemberScope,
  membershipId: string,
  token: { hash: string; cipher: Uint8Array<ArrayBuffer>; createdAt: Date },
): Promise<boolean> {
  const { count } = await db.memberCard.updateMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    data: {
      shareTokenHash: token.hash,
      shareTokenCipher: token.cipher,
      shareTokenCreatedAt: token.createdAt,
    },
  });
  return count === 1;
}

/** Replaces the layout of the card: every placement goes in, every other one is taken off. */
export async function replacePlacements(
  scope: MemberScope,
  membershipId: string,
  placements: Array<{
    key: StickerRef;
    x: number;
    y: number;
    rotation: number;
    scale: number;
    z: number;
  }>,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const card = await tx.memberCard.findFirst({
      where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
      select: { id: true },
    });
    if (!card) return false;
    await tx.badgePlacement.deleteMany({ where: { cardId: card.id } });
    await tx.badgePlacement.createMany({
      data: placements.map((placement) => ({
        cardId: card.id,
        badgeKey: placement.key,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        scale: placement.scale,
        z: placement.z,
      })),
    });
    return true;
  });
}

// ─── Awards ───────────────────────────────────────────────────

const awardTargetSelect = {
  id: true,
  userId: true,
  clubId: true,
  removedAt: true,
  club: { select: { archivedAt: true } },
  committeeMemberships: { where: { removedAt: null }, select: { committeeId: true } },
} satisfies Prisma.MembershipSelect;

export type AwardTarget = Prisma.MembershipGetPayload<{ select: typeof awardTargetSelect }>;

/** A membership the actor can see, with what the award rules need to know about it. */
export async function findAwardTarget(
  scope: MemberScope,
  membershipId: string,
): Promise<AwardTarget | null> {
  return db.membership.findFirst({
    where: { AND: [scope, { id: membershipId }] },
    select: awardTargetSelect,
  });
}

/** What a member holds that was awarded, newest first. */
export async function findMemberAwards(
  scope: MemberScope,
  membershipId: string,
): Promise<Array<{ badgeKey: string; awardedAt: Date; reason: string | null }>> {
  return db.badgeAward.findMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    select: { badgeKey: true, awardedAt: true, reason: true },
    orderBy: { awardedAt: 'desc' },
  });
}

/** Awards a sticker; awarding what the member already holds changes nothing and returns that row. */
export async function createAward(
  scope: MemberScope,
  target: { membershipId: string; clubId: string },
  badgeKey: StickerRef,
  awardedById: string,
  now: Date,
  reason: string | null = null,
): Promise<{ badgeKey: string; awardedAt: Date; reason: string | null } | null> {
  const inScope = await db.membership.findFirst({
    where: { AND: [scope, { id: target.membershipId, clubId: target.clubId }] },
    select: { id: true },
  });
  if (!inScope) return null;
  await db.badgeAward.createMany({
    data: [
      {
        membershipId: target.membershipId,
        clubId: target.clubId,
        badgeKey,
        awardedById,
        awardedAt: now,
        reason,
      },
    ],
    skipDuplicates: true,
  });
  return db.badgeAward.findUnique({
    where: { membershipId_badgeKey: { membershipId: target.membershipId, badgeKey } },
    select: { badgeKey: true, awardedAt: true, reason: true },
  });
}

/** Takes an awarded sticker back, and its place on the card with it. */
export async function deleteAward(
  scope: MemberScope,
  membershipId: string,
  badgeKey: StickerRef,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.badgeAward.deleteMany({
      where: { AND: [{ membershipId, badgeKey }, { membership: { AND: [scope] } }] },
    });
    if (count > 0) {
      await tx.badgePlacement.deleteMany({
        where: { badgeKey, card: { membershipId } },
      });
    }
    return count;
  });
}

// ─── The public page ──────────────────────────────────────────

const publicSelect = {
  ...cardSelect,
  membership: {
    select: {
      id: true,
      clubId: true,
      removedAt: true,
      role: true,
      user: { select: { fullName: true, deletedAt: true } },
      club: { select: { name: true, slug: true, archivedAt: true } },
      membershipType: { select: { name: true } },
      committeeMemberships: {
        where: { removedAt: null },
        select: { role: true, committee: { select: { name: true } } },
        orderBy: { committee: { name: 'asc' } },
      },
    },
  },
} satisfies Prisma.MemberCardSelect;

export type PublicCardRow = Prisma.MemberCardGetPayload<{ select: typeof publicSelect }>;

/** The card a token opens. A token that matches nothing returns null. */
export async function findCardByTokenHash(hash: string): Promise<PublicCardRow | null> {
  return db.memberCard.findUnique({ where: { shareTokenHash: hash }, select: publicSelect });
}

/** The awards of one membership, for the public page (the membership is the one the token resolved to). */
export async function findAwardsOfMembership(
  scope: MemberScope,
  membershipId: string,
): Promise<Array<{ badgeKey: string; awardedAt: Date; reason: string | null }>> {
  return db.badgeAward.findMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    select: { badgeKey: true, awardedAt: true, reason: true },
  });
}

// ─── A full admin's delete of a person ────────────────────────

/**
 * Everything the card feature holds about a person's memberships: placements, cards, awards. Run
 * by the person delete before it removes the memberships (docs/adr/0026-person-deletion.md).
 */
export async function deletePersonCardData(
  tx: TransactionClient,
  scope: MemberScope,
  userId: string,
): Promise<{ cards: number; awards: number }> {
  const memberships = await tx.membership.findMany({
    where: { AND: [scope, { userId }] },
    select: { id: true },
  });
  const ids = memberships.map((membership) => membership.id);
  if (ids.length === 0) return { cards: 0, awards: 0 };
  await tx.badgePlacement.deleteMany({ where: { card: { membershipId: { in: ids } } } });
  await tx.stickerClaimRedemption.deleteMany({ where: { membershipId: { in: ids } } });
  const cards = await tx.memberCard.deleteMany({ where: { membershipId: { in: ids } } });
  const awards = await tx.badgeAward.deleteMany({ where: { membershipId: { in: ids } } });
  return { cards: cards.count, awards: awards.count };
}

// ─── Custom stickers (docs/adr/0033-custom-stickers.md) ───────

const customSelect = {
  id: true,
  clubId: true,
  name: true,
  howTo: true,
  label: true,
  icon: true,
  shape: true,
  background: true,
  ink: true,
  hidden: true,
  awardableBy: true,
  rarity: true,
  availableFrom: true,
  availableUntil: true,
  maxHolders: true,
  createdById: true,
  createdAt: true,
  archivedAt: true,
} satisfies Prisma.CustomStickerSelect;

export type CustomStickerRow = Prisma.CustomStickerGetPayload<{ select: typeof customSelect }>;

/** A club the actor can see, with what the studio needs to know about it. */
export async function findClubForStickers(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string; archivedAt: Date | null } | null> {
  return db.club.findFirst({
    where: { AND: [scope, { id: clubId }] },
    select: { id: true, archivedAt: true },
  });
}

/** A club's custom stickers, newest first, read through the actor's club scope. */
export async function findClubCustomStickers(
  scope: ClubScope,
  clubId: string,
  includeArchived: boolean,
): Promise<CustomStickerRow[]> {
  return db.customSticker.findMany({
    where: {
      AND: [{ clubId, club: { AND: [scope] } }, includeArchived ? {} : { archivedAt: null }],
    },
    select: customSelect,
    orderBy: { createdAt: 'desc' },
  });
}

/** One custom sticker in a club the actor can see. */
export async function findCustomSticker(
  scope: ClubScope,
  stickerId: string,
): Promise<CustomStickerRow | null> {
  return db.customSticker.findFirst({
    where: { AND: [{ id: stickerId }, { club: { AND: [scope] } }] },
    select: customSelect,
  });
}

/**
 * The designs behind the custom keys on a card. The keys come from awards already read through a
 * member scope, and a design is only used when it belongs to a club the card is in.
 */
export async function findCustomStickersByIds(
  ids: readonly string[],
  clubIds: readonly string[],
): Promise<CustomStickerRow[]> {
  if (ids.length === 0) return [];
  return db.customSticker.findMany({
    where: { id: { in: [...ids] }, clubId: { in: [...clubIds] } },
    select: customSelect,
  });
}

/** Every custom sticker of one club, archived and hidden ones too: for the award rules of a member the actor can see. */
export async function findClubCustomStickersForAwards(clubId: string): Promise<CustomStickerRow[]> {
  return db.customSticker.findMany({ where: { clubId }, select: customSelect });
}

/** The visible, live custom stickers of some clubs: what a member sees locked in their tray. */
export async function findVisibleCustomStickers(
  clubIds: readonly string[],
): Promise<CustomStickerRow[]> {
  if (clubIds.length === 0) return [];
  return db.customSticker.findMany({
    where: { clubId: { in: [...clubIds] }, archivedAt: null, hidden: false },
    select: customSelect,
    orderBy: { createdAt: 'asc' },
  });
}

/** How many members hold each of these stickers. */
export async function countHolders(keys: readonly string[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await db.badgeAward.groupBy({
    by: ['badgeKey'],
    where: { badgeKey: { in: [...keys] } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.badgeKey, row._count._all]));
}

export interface CustomStickerData {
  name: string;
  howTo: string;
  label: string;
  icon: string;
  shape: string;
  background: string;
  ink: string;
  hidden: boolean;
  awardableBy: StickerAwardBy;
  rarity: StickerRarity;
  availableFrom: Date | null;
  availableUntil: Date | null;
  maxHolders: number | null;
}

/**
 * Makes a sticker in a club the actor can see, unless the club already keeps `limit` live ones.
 * Counting and creating happen in one transaction, so two leaders cannot both take the last place.
 * Returns null when the club is out of the actor's scope, `'limit'` when it is full.
 */
export async function createCustomSticker(
  scope: ClubScope,
  clubId: string,
  data: CustomStickerData,
  createdById: string,
  limit: number,
): Promise<CustomStickerRow | 'limit' | null> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.findFirst({
      where: { AND: [scope, { id: clubId }] },
      select: { id: true },
    });
    if (!club) return null;
    const live = await tx.customSticker.count({ where: { clubId, archivedAt: null } });
    if (live >= limit) return 'limit' as const;
    return tx.customSticker.create({
      data: { ...data, clubId, createdById },
      select: customSelect,
    });
  });
}

/** Changes a sticker in a club the actor can see; false when nothing in scope matched. */
export async function updateCustomSticker(
  scope: ClubScope,
  stickerId: string,
  data: Partial<CustomStickerData> & { archivedAt?: Date | null },
): Promise<boolean> {
  const { count } = await db.customSticker.updateMany({
    where: { AND: [{ id: stickerId }, { club: { AND: [scope] } }] },
    data,
  });
  return count === 1;
}

/** Every custom sticker of a club, for the full admin's club delete. */
export async function deleteClubCustomStickers(
  tx: TransactionClient,
  scope: ClubScope,
  clubId: string,
): Promise<number> {
  const { count } = await tx.customSticker.deleteMany({
    where: { AND: [{ clubId }, { club: { AND: [scope] } }] },
  });
  return count;
}

// ─── The album, seasons and caps (docs/adr/0034-album-claims-and-seasons.md) ─────────────────

/** How many members of the club hold each of these stickers (awards only; a rule's sticker has none). */
export async function countClubHolders(
  clubId: string,
  keys: readonly string[],
): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const rows = await db.badgeAward.groupBy({
    by: ['badgeKey'],
    where: { clubId, badgeKey: { in: [...keys] }, membership: { removedAt: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.badgeKey, row._count._all]));
}

/** The club's active members: what a percentage of holders is a percentage of. */
export async function countActiveClubMembers(clubId: string): Promise<number> {
  return db.membership.count({ where: { clubId, removedAt: null } });
}

/** When, by whom and how many placed: the raw numbers behind a sticker's stats. */
export async function findStickerAwards(
  clubId: string,
  badgeKey: string,
): Promise<
  Array<{
    membershipId: string;
    awardedAt: Date;
    awardedBy: { id: string; fullName: string; deletedAt: Date | null };
  }>
> {
  const rows = await db.badgeAward.findMany({
    where: { clubId, badgeKey, membership: { removedAt: null } },
    select: {
      membershipId: true,
      awardedAt: true,
      awardedBy: { select: { id: true, fullName: true, deletedAt: true } },
    },
  });
  return rows.map((row) => ({
    membershipId: row.membershipId,
    awardedAt: row.awardedAt,
    awardedBy: row.awardedBy,
  }));
}

/** How many of these memberships have the sticker stuck on their card. */
export async function countPlacedOn(
  badgeKey: string,
  membershipIds: readonly string[],
): Promise<number> {
  if (membershipIds.length === 0) return 0;
  return db.badgePlacement.count({
    where: { badgeKey, card: { membershipId: { in: [...membershipIds] } } },
  });
}

/**
 * Gives a custom sticker to a member while holding the sticker's own row, so two awards cannot
 * both take its last place. `'full'` when the cap is reached and the member does not hold it yet.
 */
export async function createCappedAward(
  scope: MemberScope,
  target: { membershipId: string; clubId: string },
  stickerId: string,
  maxHolders: number,
  awardedById: string,
  now: Date,
  reason: string | null,
): Promise<{ badgeKey: string; awardedAt: Date; reason: string | null } | 'full' | null> {
  const badgeKey = `custom:${stickerId}`;
  return db.$transaction(async (tx) => {
    const inScope = await tx.membership.findFirst({
      where: { AND: [scope, { id: target.membershipId, clubId: target.clubId }] },
      select: { id: true },
    });
    if (!inScope) return null;
    await tx.$queryRaw`SELECT "id" FROM "CustomSticker" WHERE "id" = ${stickerId}::uuid FOR UPDATE`;
    const existing = await tx.badgeAward.findUnique({
      where: { membershipId_badgeKey: { membershipId: target.membershipId, badgeKey } },
      select: { badgeKey: true, awardedAt: true, reason: true },
    });
    if (existing) return existing;
    const held = await tx.badgeAward.count({
      where: { clubId: target.clubId, badgeKey, membership: { removedAt: null } },
    });
    if (held >= maxHolders) return 'full' as const;
    return tx.badgeAward.create({
      data: {
        membershipId: target.membershipId,
        clubId: target.clubId,
        badgeKey,
        awardedById,
        awardedAt: now,
        reason,
      },
      select: { badgeKey: true, awardedAt: true, reason: true },
    });
  });
}

// ─── Claim codes ──────────────────────────────────────────────

const claimSelect = {
  id: true,
  clubId: true,
  committeeId: true,
  badgeKey: true,
  title: true,
  maxClaims: true,
  expiresAt: true,
  closedAt: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.StickerClaimSelect;

export type ClaimRow = Prisma.StickerClaimGetPayload<{ select: typeof claimSelect }>;

export async function createClaimRow(
  scope: ClubScope,
  data: {
    clubId: string;
    committeeId: string | null;
    badgeKey: string;
    title: string;
    maxClaims: number;
    expiresAt: Date;
    createdById: string;
    createdAt: Date;
  },
): Promise<ClaimRow | null> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.findFirst({
      where: { AND: [scope, { id: data.clubId }] },
      select: { id: true },
    });
    if (!club) return null;
    return tx.stickerClaim.create({ data, select: claimSelect });
  });
}

/** A club's codes, newest first, read through the actor's club scope. */
export async function findClubClaims(
  scope: ClubScope,
  clubId: string,
  createdById: string | null,
): Promise<ClaimRow[]> {
  return db.stickerClaim.findMany({
    where: {
      AND: [{ clubId, club: { AND: [scope] } }, createdById === null ? {} : { createdById }],
    },
    select: claimSelect,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/** One code in a club the actor can see. */
export async function findClaim(scope: ClubScope, claimId: string): Promise<ClaimRow | null> {
  return db.stickerClaim.findFirst({
    where: { AND: [{ id: claimId }, { club: { AND: [scope] } }] },
    select: claimSelect,
  });
}

/** A code by id alone: only called once the code's own MAC has been checked. */
export async function findClaimByVerifiedId(claimId: string): Promise<ClaimRow | null> {
  return db.stickerClaim.findUnique({ where: { id: claimId }, select: claimSelect });
}

export async function countClaimRedemptions(
  claimIds: readonly string[],
): Promise<Map<string, number>> {
  if (claimIds.length === 0) return new Map();
  const rows = await db.stickerClaimRedemption.groupBy({
    by: ['claimId'],
    where: { claimId: { in: [...claimIds] } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.claimId, row._count._all]));
}

/** Stops a code. False when nothing in scope matched. Closing one already closed keeps its first time. */
export async function closeClaimRow(
  scope: ClubScope,
  claimId: string,
  now: Date,
): Promise<boolean> {
  const found = await db.stickerClaim.findFirst({
    where: { AND: [{ id: claimId }, { club: { AND: [scope] } }] },
    select: { id: true, closedAt: true },
  });
  if (!found) return false;
  if (found.closedAt === null) {
    await db.stickerClaim.updateMany({
      where: { id: claimId, closedAt: null },
      data: { closedAt: now },
    });
  }
  return true;
}

export type RedeemOutcome =
  'ok' | 'closed' | 'full' | 'already_claimed' | 'already_holds' | 'sold_out';

/**
 * One member redeeming one code. The code's row is locked first, so the count of redemptions and
 * the cap on the sticker are read and written as one step: two phones scanning the last place
 * cannot both get it.
 */
export async function redeemClaimRow(input: {
  claimId: string;
  membershipId: string;
  clubId: string;
  badgeKey: string;
  awardedById: string;
  reason: string;
  cap: { stickerId: string; max: number } | null;
  now: Date;
}): Promise<RedeemOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StickerClaim" WHERE "id" = ${input.claimId}::uuid FOR UPDATE`;
    const claim = await tx.stickerClaim.findUnique({
      where: { id: input.claimId },
      select: { maxClaims: true, expiresAt: true, closedAt: true },
    });
    if (!claim || claim.closedAt !== null || claim.expiresAt <= input.now) return 'closed' as const;
    const claimed = await tx.stickerClaimRedemption.count({ where: { claimId: input.claimId } });
    if (claimed >= claim.maxClaims) return 'full' as const;
    const mine = await tx.stickerClaimRedemption.findUnique({
      where: {
        claimId_membershipId: { claimId: input.claimId, membershipId: input.membershipId },
      },
      select: { id: true },
    });
    if (mine) return 'already_claimed' as const;
    const holds = await tx.badgeAward.findUnique({
      where: {
        membershipId_badgeKey: { membershipId: input.membershipId, badgeKey: input.badgeKey },
      },
      select: { id: true },
    });
    if (holds) return 'already_holds' as const;
    if (input.cap) {
      await tx.$queryRaw`SELECT "id" FROM "CustomSticker" WHERE "id" = ${input.cap.stickerId}::uuid FOR UPDATE`;
      const held = await tx.badgeAward.count({
        where: {
          clubId: input.clubId,
          badgeKey: input.badgeKey,
          membership: { removedAt: null },
        },
      });
      if (held >= input.cap.max) return 'sold_out' as const;
    }
    await tx.stickerClaimRedemption.create({
      data: {
        claimId: input.claimId,
        membershipId: input.membershipId,
        redeemedAt: input.now,
      },
    });
    await tx.badgeAward.create({
      data: {
        membershipId: input.membershipId,
        clubId: input.clubId,
        badgeKey: input.badgeKey,
        awardedById: input.awardedById,
        awardedAt: input.now,
        reason: input.reason,
      },
    });
    return 'ok' as const;
  });
}

/** Every code of a club, with its redemptions, for the full admin's club delete. */
export async function deleteClubClaims(
  tx: TransactionClient,
  scope: ClubScope,
  clubId: string,
): Promise<number> {
  const claims = await tx.stickerClaim.findMany({
    where: { AND: [{ clubId }, { club: { AND: [scope] } }] },
    select: { id: true },
  });
  const ids = claims.map((claim) => claim.id);
  if (ids.length === 0) return 0;
  await tx.stickerClaimRedemption.deleteMany({ where: { claimId: { in: ids } } });
  const { count } = await tx.stickerClaim.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/** A club's name and whether it is archived, for a code read by capability (no actor scope). */
export async function findClubName(
  clubId: string,
): Promise<{ name: string; archivedAt: Date | null } | null> {
  return db.club.findUnique({ where: { id: clubId }, select: { name: true, archivedAt: true } });
}

/** Whether a committee belongs to a club. */
export async function committeeBelongsToClub(
  committeeId: string,
  clubId: string,
): Promise<boolean> {
  return (await db.committee.count({ where: { id: committeeId, clubId } })) === 1;
}
