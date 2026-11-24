import 'server-only';

import type { MemberScope } from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { CardTone, Prisma } from '@/server/db/generated/client';
import type { StickerKey } from '@/shared/lib/stickers';

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
): Promise<Array<{ membershipId: string; badgeKey: string; awardedAt: Date }>> {
  return db.badgeAward.findMany({
    where: { membership: { AND: [scope] } },
    select: { membershipId: true, badgeKey: true, awardedAt: true },
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
    key: StickerKey;
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
): Promise<Array<{ badgeKey: string; awardedAt: Date }>> {
  return db.badgeAward.findMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    select: { badgeKey: true, awardedAt: true },
    orderBy: { awardedAt: 'desc' },
  });
}

/** Awards a sticker; awarding what the member already holds changes nothing and returns that row. */
export async function createAward(
  scope: MemberScope,
  target: { membershipId: string; clubId: string },
  badgeKey: StickerKey,
  awardedById: string,
  now: Date,
): Promise<{ badgeKey: string; awardedAt: Date } | null> {
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
      },
    ],
    skipDuplicates: true,
  });
  return db.badgeAward.findUnique({
    where: { membershipId_badgeKey: { membershipId: target.membershipId, badgeKey } },
    select: { badgeKey: true, awardedAt: true },
  });
}

/** Takes an awarded sticker back, and its place on the card with it. */
export async function deleteAward(
  scope: MemberScope,
  membershipId: string,
  badgeKey: StickerKey,
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
): Promise<string[]> {
  const rows = await db.badgeAward.findMany({
    where: { AND: [{ membershipId }, { membership: { AND: [scope] } }] },
    select: { badgeKey: true },
  });
  return rows.map((row) => row.badgeKey);
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
