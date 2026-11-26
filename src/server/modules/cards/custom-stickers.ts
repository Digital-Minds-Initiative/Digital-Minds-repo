import 'server-only';

import { AuthzError, clubsScope, type Actor } from '@/server/authz';
import { clubArchived, ConflictError, NotFoundError } from '@/server/errors';
import type { CustomStickerFields, StudioSticker } from '@/shared/contracts/stickers';
import { CUSTOM_STICKER_LIMITS, customStickerKey } from '@/shared/lib/stickers';

import { canDesignStickers, canEditSticker } from './policies';
import {
  countHolders,
  createCustomSticker,
  findClubCustomStickers,
  findClubForStickers,
  findCustomSticker,
  updateCustomSticker,
  type CustomStickerRow,
} from './repository';

/*
 * The sticker studio (docs/adr/0033-custom-stickers.md): the stickers a club's leaders design.
 * A club is read through the actor's club scope first (404 outside it); then who may design is
 * checked (403 `sticker_design_not_allowed`), then the state of the club (409).
 */

const designNotAllowed = () => new AuthzError('sticker_design_not_allowed');

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
    fields,
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
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
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
