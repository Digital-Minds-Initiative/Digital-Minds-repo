import 'server-only';

import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import { cardLinkMemberScope, membersScope, ownMembershipsScope, type Actor } from '@/server/authz';
import {
  clubArchived,
  memberRemovedFromClub,
  NotFoundError,
  RateLimitedError,
  stickerArchived,
  ConflictError,
} from '@/server/errors';
import { getPointsForCardLink } from '@/server/modules/points';
import { consumeFixedWindow } from '@/server/modules/rate-limit';
import type { PublicCard, UpdateMyCardBody } from '@/shared/contracts/cards';
import type { EarnedSticker } from '@/shared/contracts/wallet';
import { todayInAppTimeZone } from '@/shared/lib/dates';
import {
  CARD_STAMPS_TOTAL,
  cardMoodForClub,
  cardToneFor,
  cardYears,
  lastSixMonths,
  stampIsHalf,
  stampsForPoints,
} from '@/shared/lib/member-card';
import {
  AWARDABLE_STICKER_KEYS,
  canAwardCustomSticker,
  canAwardSticker,
  customStickerId,
  derivedStickers,
  isCustomStickerKey,
  isStickerOpen,
  STICKER_KEYS,
  STICKER_RULES,
  type CustomStickerDef,
  type CustomStickerKey,
  type StickerKey,
  type StickerPlacement,
  type StickerRef,
} from '@/shared/lib/stickers';
import { cardRoleLabel } from '@/shared/lib/wallet-pass';

import { assertCanAward, assertCanAwardCustom, awarderStanding } from './policies';
import {
  createAward,
  createCappedAward,
  createMissingCards,
  deleteAward,
  findAwardTarget,
  findAwards,
  findAwardsOfMembership,
  findCardByTokenHash,
  findClubCustomStickersForAwards,
  findCards,
  findCustomStickersByIds,
  findMemberAwards,
  findVisibleCustomStickers,
  replaceCardToken,
  replacePlacements,
  updateCardChoices,
  type CardRow,
  type CustomStickerRow,
} from './repository';
import { cardLinkUrl, cardTokenHash, decryptCardToken, newCardToken } from './token';

const isStickerKey = (value: string): value is StickerRef =>
  (STICKER_KEYS as readonly string[]).includes(value) || isCustomStickerKey(value);

/** A stored custom sticker as the screens draw it. */
export function toCustomDef(row: CustomStickerRow): CustomStickerDef {
  return {
    key: `custom:${row.id}`,
    name: row.name,
    howTo: row.howTo,
    label: row.label,
    icon: row.icon as CustomStickerDef['icon'],
    shape: row.shape as CustomStickerDef['shape'],
    background: row.background as CustomStickerDef['background'],
    ink: row.ink as CustomStickerDef['ink'],
    hidden: row.hidden,
    rarity: row.rarity,
    availableFrom: row.availableFrom?.toISOString() ?? null,
    availableUntil: row.availableUntil?.toISOString() ?? null,
  };
}

/** One award as the card needs it: when, and what for. */
interface AwardFact {
  awardedAt: Date;
  reason: string | null;
}

/** What the card needs to know about each membership the actor holds to work out its stickers and colour. */
export interface CardFacts {
  membershipId: string;
  clubRole: 'MEMBER' | 'CLUB_OFFICER';
  ledCommittees: readonly string[];
  /** The active points balance and the number of active transactions. */
  points: number;
  transactions: number;
}

export interface CardExtras {
  tone: 'paper' | 'matte';
  tonePreference: 'paper' | 'matte' | null;
  stickers: EarnedSticker[];
  /** Custom stickers of the member's clubs that anyone may see and earn, shown locked in the tray. */
  lockedStickers: CustomStickerDef[];
  share: {
    enabled: boolean;
    showPoints: boolean;
    showActivity: boolean;
    url: string | null;
  };
}

function toPlacement(row: CardRow['placements'][number]): StickerPlacement | null {
  return isStickerKey(row.badgeKey)
    ? { key: row.badgeKey, x: row.x, y: row.y, rotation: row.rotation, scale: row.scale, z: row.z }
    : null;
}

/**
 * The stickers a member holds, from the rules and from the awards, each with where it lies, and for
 * an awarded one when it was given, what for and, for a custom one, its design. A custom sticker
 * whose design cannot be found (another club's, or deleted) is not shown.
 */
function earnedStickers(
  facts: CardFacts,
  awarded: ReadonlyMap<string, AwardFact>,
  placements: readonly StickerPlacement[],
  customs: ReadonlyMap<string, CustomStickerDef>,
  showReasons = true,
): EarnedSticker[] {
  const byKey = new Map(placements.map((placement) => [placement.key as string, placement]));
  const keys = new Set<StickerKey>(
    derivedStickers({
      clubRole: facts.clubRole,
      ledCommittees: facts.ledCommittees.length,
      points: facts.points,
      transactions: facts.transactions,
    }),
  );
  for (const key of AWARDABLE_STICKER_KEYS) if (awarded.has(key)) keys.add(key);

  const detail = (key: string) => {
    const award = awarded.get(key);
    return {
      earnedAt: award ? award.awardedAt.toISOString() : null,
      reason: award && showReasons ? award.reason : null,
    };
  };
  const builtin = STICKER_KEYS.filter((key) => keys.has(key)).map((key) => ({
    key: key as StickerRef,
    source: STICKER_RULES[key].source,
    placement: byKey.get(key) ?? null,
    ...detail(key),
    custom: null,
  }));
  const custom = [...awarded.entries()]
    .filter(([key]) => isCustomStickerKey(key) && customs.has(key))
    .sort((a, b) => a[1].awardedAt.getTime() - b[1].awardedAt.getTime())
    .map(([key]) => ({
      key: key as StickerRef,
      source: 'awarded' as const,
      placement: byKey.get(key) ?? null,
      ...detail(key),
      custom: customs.get(key) ?? null,
    }));
  return [...builtin, ...custom];
}

/** The designs of the custom stickers named in some awards, only those that belong to `clubIds`. */
async function customDefsFor(
  awardKeys: readonly string[],
  clubIds: readonly string[],
): Promise<Map<string, CustomStickerDef>> {
  const ids = awardKeys.filter(isCustomStickerKey).map((key) => customStickerId(key));
  const rows = await findCustomStickersByIds(ids, clubIds);
  return new Map(rows.map((row) => [`custom:${row.id}`, toCustomDef(row)]));
}

/**
 * The card parts that belong to the person: the colour they chose, what their QR link shows, the
 * stickers they hold and where they lie. The first time a card is read its row is made, with a
 * link of its own; a link whose copy cannot be read (another secret, damage) is replaced.
 */
export async function getMyCardExtras(
  actor: Actor,
  facts: readonly CardFacts[],
  now = new Date(),
): Promise<Map<string, CardExtras>> {
  const scope = ownMembershipsScope(actor);
  let cards = await findCards(scope);
  const have = new Set(cards.map((card) => card.membershipId));
  const missing = facts
    .filter((fact) => !have.has(fact.membershipId))
    .flatMap((fact) => {
      const membership = actor.memberships.find((m) => m.membershipId === fact.membershipId);
      if (!membership) return [];
      return [
        {
          membershipId: fact.membershipId,
          clubId: membership.clubId,
          token: newCardToken(fact.membershipId, now),
        },
      ];
    });
  if (missing.length > 0) {
    await createMissingCards(missing);
    cards = await findCards(scope);
  }
  const awards = await findAwards(scope);
  const clubIds = [...new Set(actor.memberships.map((m) => m.clubId))];
  const [customs, visible] = await Promise.all([
    customDefsFor(
      awards.map((award) => award.badgeKey),
      clubIds,
    ),
    findVisibleCustomStickers(clubIds),
  ]);

  const out = new Map<string, CardExtras>();
  for (const fact of facts) {
    const card = cards.find((candidate) => candidate.membershipId === fact.membershipId);
    if (!card) continue;
    let token = decryptCardToken(card.shareTokenCipher, card.membershipId);
    if (token === null) {
      const fresh = newCardToken(card.membershipId, now);
      await replaceCardToken(scope, card.membershipId, fresh);
      token = fresh.token;
    }
    const awarded = new Map<string, AwardFact>(
      awards
        .filter((award) => award.membershipId === card.membershipId)
        .map((award) => [award.badgeKey, { awardedAt: award.awardedAt, reason: award.reason }]),
    );
    const placements = card.placements.flatMap((row) => toPlacement(row) ?? []);
    const preference = card.tone === null ? null : card.tone === 'MATTE' ? 'matte' : 'paper';
    out.set(fact.membershipId, {
      tone:
        preference ?? cardToneFor({ clubRole: fact.clubRole, ledCommittees: fact.ledCommittees }),
      tonePreference: preference,
      stickers: earnedStickers(fact, awarded, placements, customs),
      lockedStickers: visible
        .filter((row) => row.clubId === card.clubId && !awarded.has(`custom:${row.id}`))
        .map(toCustomDef),
      share: {
        enabled: card.shareEnabled,
        showPoints: card.showPoints,
        showActivity: card.showActivity,
        url: card.shareEnabled ? cardLinkUrl(token) : null,
      },
    });
  }
  return out;
}

/** The colour and the sharing choices of one of the caller's own cards. */
export async function updateMyCardChoices(
  actor: Actor,
  membershipId: string,
  body: UpdateMyCardBody,
  now = new Date(),
): Promise<void> {
  const scope = ownMembershipsScope(actor);
  const membership = actor.memberships.find((m) => m.membershipId === membershipId);
  if (!membership) throw new NotFoundError('Membership');
  // The card exists once it has been read; make sure of it, so a first write is not a 404.
  await createMissingCards([
    { membershipId, clubId: membership.clubId, token: newCardToken(membershipId, now) },
  ]);
  const changed = await updateCardChoices(scope, membershipId, {
    ...(body.tone === undefined
      ? {}
      : { tone: body.tone === null ? null : body.tone === 'matte' ? 'MATTE' : 'PAPER' }),
    ...(body.share?.enabled === undefined ? {} : { shareEnabled: body.share.enabled }),
    ...(body.share?.showPoints === undefined ? {} : { showPoints: body.share.showPoints }),
    ...(body.share?.showActivity === undefined ? {} : { showActivity: body.share.showActivity }),
  });
  if (!changed) throw new NotFoundError('Membership');
}

/** Where the caller's stickers lie. The wallet service has already checked that each one is earned. */
export async function placeMyStickers(
  actor: Actor,
  membershipId: string,
  placements: readonly StickerPlacement[],
  now = new Date(),
): Promise<void> {
  const membership = actor.memberships.find((m) => m.membershipId === membershipId);
  if (!membership) throw new NotFoundError('Membership');
  await createMissingCards([
    { membershipId, clubId: membership.clubId, token: newCardToken(membershipId, now) },
  ]);
  const placed = await replacePlacements(ownMembershipsScope(actor), membershipId, [...placements]);
  if (!placed) throw new NotFoundError('Membership');
}

/** A new link for the QR: the old one stops working at once. */
export async function renewMyCardLink(
  actor: Actor,
  membershipId: string,
  now = new Date(),
): Promise<void> {
  const membership = actor.memberships.find((m) => m.membershipId === membershipId);
  if (!membership) throw new NotFoundError('Membership');
  await createMissingCards([
    { membershipId, clubId: membership.clubId, token: newCardToken(membershipId, now) },
  ]);
  const renewed = await replaceCardToken(
    ownMembershipsScope(actor),
    membershipId,
    newCardToken(membershipId, now),
  );
  if (!renewed) throw new NotFoundError('Membership');
}

// ─── Awards ───────────────────────────────────────────────────

/** The member as the award rules see them, or the 404 for anyone outside the actor's scope. */
async function loadAwardTarget(actor: Actor, membershipId: string) {
  const target = await findAwardTarget(membersScope(actor), membershipId);
  if (!target) throw new NotFoundError('Member');
  return {
    membershipId: target.id,
    userId: target.userId,
    clubId: target.clubId,
    committeeIds: target.committeeMemberships.map((entry) => entry.committeeId),
    removed: target.removedAt !== null,
    clubArchived: target.club.archivedAt !== null,
  };
}

/** The custom stickers of a member's club, by key, with who may give each. */
async function clubCustomStickers(clubId: string): Promise<Map<string, CustomStickerRow>> {
  const rows = await findClubCustomStickersForAwards(clubId);
  return new Map(rows.map((row) => [`custom:${row.id}`, row]));
}

/** What a member was awarded, and which awardable stickers the caller may still give them. */
export async function listMemberStickers(actor: Actor, membershipId: string) {
  const target = await loadAwardTarget(actor, membershipId);
  const awarded = await findMemberAwards(membersScope(actor), membershipId);
  const held = new Set(awarded.map((award) => award.badgeKey));
  const standing = awarderStanding(actor, target);
  const mayAward = actor.isFullAdmin || actor.userId !== target.userId;
  const customs = await clubCustomStickers(target.clubId);

  const awardedOut = awarded.flatMap((award) => {
    const builtin = AWARDABLE_STICKER_KEYS.find((candidate) => candidate === award.badgeKey);
    if (builtin !== undefined) {
      return [
        {
          key: builtin as StickerRef,
          awardedAt: award.awardedAt.toISOString(),
          reason: award.reason,
          revocable: mayAward && canAwardSticker(standing, builtin),
        },
      ];
    }
    const row = customs.get(award.badgeKey);
    return row
      ? [
          {
            key: award.badgeKey as StickerRef,
            awardedAt: award.awardedAt.toISOString(),
            reason: award.reason,
            revocable: mayAward && canAwardCustomSticker(standing, row.awardableBy),
          },
        ]
      : [];
  });
  const awardableCustom = mayAward
    ? [...customs.entries()].filter(
        ([key, row]) =>
          row.archivedAt === null &&
          !held.has(key) &&
          canAwardCustomSticker(standing, row.awardableBy),
      )
    : [];
  const shown = new Set<string>([
    ...awardableCustom.map(([key]) => key),
    ...awardedOut.map((award) => award.key as string),
  ]);
  return {
    awarded: awardedOut,
    awardable: [
      ...(mayAward
        ? AWARDABLE_STICKER_KEYS.filter((key) => !held.has(key) && canAwardSticker(standing, key))
        : []),
      ...awardableCustom.map(([key]) => key as StickerRef),
    ],
    custom: [...customs.entries()]
      .filter(([key]) => shown.has(key))
      .map(([, row]) => toCustomDef(row)),
  };
}

export async function awardSticker(
  actor: Actor,
  membershipId: string,
  key: StickerRef,
  reason: string | null = null,
  now = new Date(),
) {
  const target = await loadAwardTarget(actor, membershipId);
  let cap: number | null = null;
  if (isCustomStickerKey(key)) {
    const row = (await clubCustomStickers(target.clubId)).get(key);
    if (!row) throw new NotFoundError('Sticker');
    assertCanAwardCustom(actor, target, row.awardableBy);
    if (row.archivedAt !== null) throw stickerArchived();
    if (!isStickerOpen(now, row)) {
      throw new ConflictError('The sticker is not open for giving now.', 'sticker_not_available');
    }
    cap = row.maxHolders;
  } else {
    assertCanAward(actor, target, key);
  }
  if (target.clubArchived) throw clubArchived();
  if (target.removed) throw memberRemovedFromClub();
  const award =
    cap === null
      ? await createAward(membersScope(actor), target, key, actor.userId, now, reason)
      : await createCappedAward(
          membersScope(actor),
          target,
          customStickerId(key as CustomStickerKey),
          cap,
          actor.userId,
          now,
          reason,
        );
  if (award === 'full') {
    throw new ConflictError('The sticker has no places left.', 'sticker_sold_out');
  }
  if (!award) throw new NotFoundError('Member');
  return {
    key,
    awardedAt: award.awardedAt.toISOString(),
    reason: award.reason,
    revocable: true,
  };
}

export async function revokeSticker(
  actor: Actor,
  membershipId: string,
  key: StickerRef,
): Promise<void> {
  const target = await loadAwardTarget(actor, membershipId);
  if (isCustomStickerKey(key)) {
    const row = (await clubCustomStickers(target.clubId)).get(key);
    if (!row) throw new NotFoundError('Sticker');
    assertCanAwardCustom(actor, target, row.awardableBy);
  } else {
    assertCanAward(actor, target, key);
  }
  const count = await deleteAward(membersScope(actor), membershipId, key);
  if (count === 0) throw new NotFoundError('Sticker');
}

// ─── The page a QR opens ──────────────────────────────────────

const PUBLIC_LIMITS = {
  cardViewPerIpMinute: { max: 60, windowSeconds: 60 },
  cardViewPerIpHour: { max: 600, windowSeconds: 3600 },
  cardViewPerTokenHour: { max: 1200, windowSeconds: 3600 },
} as const;

/** Counted before the token is looked up, so a wrong token costs what a right one costs. */
async function consumePublicCardLimits(
  token: string,
  client: { ip: string | null },
  now: Date,
): Promise<void> {
  const subjects: Record<keyof typeof PUBLIC_LIMITS, string | null> = {
    cardViewPerIpMinute: client.ip,
    cardViewPerIpHour: client.ip,
    cardViewPerTokenHour: token,
  };
  for (const [name, limit] of Object.entries(PUBLIC_LIMITS)) {
    const { exceeded, retryAfterSeconds } = await consumeFixedWindow(
      { name, ...limit },
      subjects[name as keyof typeof PUBLIC_LIMITS],
      now,
    );
    if (exceeded) throw new RateLimitedError('too_many_requests', retryAfterSeconds);
  }
}

/**
 * What a member's QR link shows. An unknown, renewed, turned-off or removed link, and the card of
 * a removed member, a deleted person or an archived club, all answer the same 404. Only what the
 * member allowed leaves: never a contact detail, never another person, and the reasons behind
 * points only when they turned that on and are showing their points at all.
 */
export async function getPublicCard(
  token: string,
  client: { ip: string | null },
  now = new Date(),
): Promise<PublicCard> {
  await consumePublicCardLimits(token, client, now);

  const card = await findCardByTokenHash(cardTokenHash(token));
  const membership = card?.membership;
  if (
    !card ||
    !membership ||
    !card.shareEnabled ||
    membership.removedAt !== null ||
    membership.user.deletedAt !== null ||
    membership.club.archivedAt !== null
  ) {
    throw new NotFoundError('Page');
  }

  const today = todayInAppTimeZone(now);
  const months = lastSixMonths(today);
  const since = `${months[0]}-01`;
  const ledCommittees = membership.committeeMemberships
    .filter((entry) => entry.role === 'LEAD')
    .map((entry) => entry.committee.name);
  const [points, awardKeys] = await Promise.all([
    getPointsForCardLink(membership.id, since),
    findAwardsOfMembership(cardLinkMemberScope(membership.id), membership.id),
  ]);

  const years = cardYears(now);
  const clubRole =
    membership.role === 'CLUB_OFFICER' ? ('CLUB_OFFICER' as const) : ('MEMBER' as const);
  const facts: CardFacts = {
    membershipId: membership.id,
    clubRole,
    ledCommittees,
    points: points.balance,
    transactions: points.transactions,
  };
  const placements = card.placements.flatMap((row) => toPlacement(row) ?? []);
  const customs = await customDefsFor(
    awardKeys.map((award) => award.badgeKey),
    [membership.clubId],
  );
  // What a sticker was given for is the giver's note about the member: shown only with the activity.
  const stickers = earnedStickers(
    facts,
    new Map(
      awardKeys.map((award) => [
        award.badgeKey,
        { awardedAt: award.awardedAt, reason: award.reason },
      ]),
    ),
    placements,
    customs,
    card.showActivity,
  ).map((sticker) => ({
    key: sticker.key,
    placement: sticker.placement,
    earnedAt: sticker.earnedAt,
    reason: sticker.reason,
    custom: sticker.custom,
  }));
  const preference = card.tone === null ? null : card.tone === 'MATTE' ? 'matte' : 'paper';

  const byMonth = new Map(months.map((month) => [month, 0]));
  for (const row of points.recent) {
    const month = row.workDate.slice(0, 7);
    if (byMonth.has(month)) byMonth.set(month, (byMonth.get(month) ?? 0) + row.amount);
  }
  const showPoints = card.showPoints;
  const thisMonth = months[5] ?? '';

  return {
    fullName: membership.user.fullName,
    club: { name: membership.club.name, slug: membership.club.slug },
    mood: cardMoodForClub(membership.club.slug),
    tone: preference ?? cardToneFor({ clubRole, ledCommittees }),
    role: cardRoleLabel(
      { clubRole, ledCommittees, role: membership.membershipType.name },
      walletPassAr,
    ),
    hijriYear: years.hijriYear,
    stampsTotal: CARD_STAMPS_TOTAL,
    points: showPoints ? points.balance : null,
    stampsEarned: showPoints ? stampsForPoints(points.balance) : null,
    stampsHalf: showPoints ? stampIsHalf(points.balance) : null,
    thisMonth: showPoints ? (byMonth.get(thisMonth) ?? 0) : null,
    monthly: showPoints
      ? months.map((month) => ({ month, points: byMonth.get(month) ?? 0 }))
      : null,
    stickers,
    activity:
      showPoints && card.showActivity
        ? points.recent.slice(0, 5).map((row) => ({
            workDate: row.workDate,
            reason: row.reason,
            amount: row.amount,
          }))
        : null,
  };
}
