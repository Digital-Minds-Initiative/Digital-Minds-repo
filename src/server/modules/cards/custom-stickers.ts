import 'server-only';

import { AuthzError, clubsScope, type Actor } from '@/server/authz';
import { clubArchived, ConflictError, NotFoundError } from '@/server/errors';
import { authorName } from '@/server/people';
import type { AlbumEntry, CustomStickerFields, StudioSticker } from '@/shared/contracts/stickers';
import { todayInAppTimeZone } from '@/shared/lib/dates';
import { lastSixMonths } from '@/shared/lib/member-card';
import {
  BUILTIN_RARITY,
  CUSTOM_STICKER_LIMITS,
  customStickerKey,
  isHiddenBuiltin,
  isStickerOpen,
  STICKER_KEYS,
  STICKER_RULES,
} from '@/shared/lib/stickers';

import { canDesignStickers, canEditSticker } from './policies';
import {
  countActiveClubMembers,
  countClubHolders,
  countHolders,
  countPlacedOn,
  findStickerAwards,
  findClubCustomStickersForAwards,
  createCustomSticker,
  findClubCustomStickers,
  findClubForStickers,
  findCustomSticker,
  updateCustomSticker,
  type CustomStickerData,
  type CustomStickerRow,
} from './repository';
import { toCustomDef } from './service';

/*
 * The sticker studio (docs/adr/0033-custom-stickers.md): the stickers a club's leaders design.
 * A club is read through the actor's club scope first (404 outside it); then who may design is
 * checked (403 `sticker_design_not_allowed`), then the state of the club (409).
 */

const designNotAllowed = () => new AuthzError('sticker_design_not_allowed');

/**
 * What the repository stores for what a leader sent: the season's two ends arrive as ISO text and
 * are stored as moments. A field left out of a change stays out of it (`null` is a real value: no
 * limit, no season).
 */
function toData<T extends Partial<CustomStickerFields>>(fields: T): Partial<CustomStickerData> {
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<CustomStickerFields>;
  const { availableFrom, availableUntil, ...rest } = defined;
  return {
    ...rest,
    ...(availableFrom === undefined
      ? {}
      : { availableFrom: availableFrom === null ? null : new Date(availableFrom) }),
    ...(availableUntil === undefined
      ? {}
      : { availableUntil: availableUntil === null ? null : new Date(availableUntil) }),
  };
}

function toStudio(row: CustomStickerRow, actor: Actor, heldBy: number): StudioSticker {
  return {
    id: row.id,
    clubId: row.clubId,
    key: customStickerKey(row.id),
    name: row.name,
    howTo: row.howTo,
    label: row.label,
    icon: row.icon as StudioSticker['icon'],
    shape: row.shape as StudioSticker['shape'],
    background: row.background as StudioSticker['background'],
    ink: row.ink as StudioSticker['ink'],
    hidden: row.hidden,
    rarity: row.rarity,
    availableFrom: row.availableFrom?.toISOString() ?? null,
    availableUntil: row.availableUntil?.toISOString() ?? null,
    maxHolders: row.maxHolders,
    awardableBy: row.awardableBy,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    heldBy,
    canEdit: canEditSticker(actor, row),
  };
}

/** The club's custom stickers, for whoever may design them. */
export async function listCustomStickers(
  actor: Actor,
  clubId: string,
  includeArchived = false,
): Promise<{ stickers: StudioSticker[] }> {
  const club = await findClubForStickers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  if (!canDesignStickers(actor, club.id)) throw designNotAllowed();
  const rows = await findClubCustomStickers(clubsScope(actor), club.id, includeArchived);
  const held = await countHolders(rows.map((row) => customStickerKey(row.id)));
  return {
    stickers: rows.map((row) => toStudio(row, actor, held.get(customStickerKey(row.id)) ?? 0)),
  };
}

export async function createSticker(
  actor: Actor,
  clubId: string,
  fields: CustomStickerFields,
): Promise<StudioSticker> {
  const club = await findClubForStickers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  if (!canDesignStickers(actor, club.id)) throw designNotAllowed();
  if (club.archivedAt !== null) throw clubArchived();
  const created = await createCustomSticker(
    clubsScope(actor),
    club.id,
    toData(fields) as CustomStickerData,
    actor.userId,
    CUSTOM_STICKER_LIMITS.perClub,
  );
  if (created === null) throw new NotFoundError('Club');
  if (created === 'limit') {
    throw new ConflictError(
      `A club keeps at most ${CUSTOM_STICKER_LIMITS.perClub} live custom stickers.`,
      'sticker_limit_reached',
    );
  }
  return toStudio(created, actor, 0);
}

export async function changeSticker(
  actor: Actor,
  stickerId: string,
  changes: Partial<CustomStickerFields> & { archived?: boolean | undefined },
): Promise<StudioSticker> {
  const row = await findCustomSticker(clubsScope(actor), stickerId);
  if (!row) throw new NotFoundError('Sticker');
  if (!canEditSticker(actor, row)) throw designNotAllowed();
  const club = await findClubForStickers(clubsScope(actor), row.clubId);
  if (!club) throw new NotFoundError('Club');
  if (club.archivedAt !== null) throw clubArchived();

  const { archived, ...fields } = changes;
  if (archived === false && row.archivedAt !== null) {
    // Bringing one back takes a place again, so the club's limit applies.
    const live = await findClubCustomStickers(clubsScope(actor), row.clubId, false);
    if (live.length >= CUSTOM_STICKER_LIMITS.perClub) {
      throw new ConflictError(
        `A club keeps at most ${CUSTOM_STICKER_LIMITS.perClub} live custom stickers.`,
        'sticker_limit_reached',
      );
    }
  }
  const defined = toData(fields);
  const ok = await updateCustomSticker(clubsScope(actor), stickerId, {
    ...defined,
    ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
  });
  if (!ok) throw new NotFoundError('Sticker');
  const fresh = await findCustomSticker(clubsScope(actor), stickerId);
  if (!fresh) throw new NotFoundError('Sticker');
  const held = await countHolders([customStickerKey(fresh.id)]);
  return toStudio(fresh, actor, held.get(customStickerKey(fresh.id)) ?? 0);
}

// ─── The album and a sticker's numbers (docs/adr/0034-album-claims-and-seasons.md) ───────────

const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.min(100, Math.round((part * 100) / whole));

/**
 * What a club's album shows a member who holds `held` (their own stickers, by key, including the
 * ones a rule gives). Built-in and designed stickers, each with its rarity, the share of the club
 * that holds it and whether it can still be given. A hidden sticker the member does not hold is
 * counted, never described.
 */
export async function buildClubAlbum(
  clubId: string,
  held: ReadonlySet<string>,
  now: Date,
): Promise<{ entries: AlbumEntry[]; secretCount: number }> {
  const customs = await findClubCustomStickersForAwards(clubId);
  const awardKeys = [
    ...STICKER_KEYS.filter((key) => STICKER_RULES[key].source === 'awarded'),
    ...customs.map((row) => customStickerKey(row.id)),
  ];
  const [holders, members] = await Promise.all([
    countClubHolders(clubId, awardKeys),
    countActiveClubMembers(clubId),
  ]);

  const entries: AlbumEntry[] = [];
  let secretCount = 0;

  for (const key of STICKER_KEYS) {
    const mine = held.has(key);
    if (isHiddenBuiltin(key) && !mine) {
      secretCount += 1;
      continue;
    }
    const given = STICKER_RULES[key].source === 'awarded';
    entries.push({
      key,
      custom: null,
      rarity: BUILTIN_RARITY[key],
      held: mine,
      heldPercent: given ? percent(holders.get(key) ?? 0, members) : null,
      availableFrom: null,
      availableUntil: null,
      // A built-in sticker never closes: a rule gives some, a person the rest, any time.
      open: true,
    });
  }
  for (const row of customs) {
    const key = customStickerKey(row.id);
    const mine = held.has(key);
    if ((row.archivedAt !== null || row.hidden) && !mine) {
      if (row.hidden && row.archivedAt === null) secretCount += 1;
      continue;
    }
    const count = holders.get(key) ?? 0;
    const def = toCustomDef(row);
    entries.push({
      key,
      custom: def,
      rarity: row.rarity,
      held: mine,
      heldPercent: percent(count, members),
      availableFrom: def.availableFrom,
      availableUntil: def.availableUntil,
      open:
        row.archivedAt === null &&
        isStickerOpen(now, row) &&
        (row.maxHolders === null || count < row.maxHolders),
    });
  }
  return { entries, secretCount };
}

export async function getStickerStats(actor: Actor, stickerId: string, now = new Date()) {
  const row = await findCustomSticker(clubsScope(actor), stickerId);
  if (!row) throw new NotFoundError('Sticker');
  if (!canDesignStickers(actor, row.clubId)) throw designNotAllowed();

  const key = customStickerKey(row.id);
  const [awards, members] = await Promise.all([
    findStickerAwards(row.clubId, key),
    countActiveClubMembers(row.clubId),
  ]);
  const placed = await countPlacedOn(
    key,
    awards.map((award) => award.membershipId),
  );

  const months = lastSixMonths(todayInAppTimeZone(now));
  const byMonth = new Map(months.map((month) => [month, 0]));
  const givers = new Map<string, { name: string; count: number }>();
  for (const award of awards) {
    // Riyadh is UTC+3 all year, so a month is the month of the instant moved three hours.
    const month = new Date(award.awardedAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
    if (byMonth.has(month)) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    const name = authorName(award.awardedBy);
    if (name === null) continue;
    const entry = givers.get(award.awardedBy.id) ?? { name, count: 0 };
    entry.count += 1;
    givers.set(award.awardedBy.id, entry);
  }
  return {
    heldBy: awards.length,
    percentOfMembers: percent(awards.length, members),
    placedPercent: percent(placed, awards.length),
    byMonth: months.map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
    givers: [...givers.values()].sort((a, b) => b.count - a.count).slice(0, 3),
  };
}
