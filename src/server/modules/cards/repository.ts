import 'server-only';

import type { ClubScope, MemberScope } from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { CardTone, Prisma, StickerAwardBy } from '@/server/db/generated/client';
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
