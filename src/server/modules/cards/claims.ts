import 'server-only';

import { AuthzError, canManageClub, clubsScope, type Actor } from '@/server/authz';
import {
  clubArchived,
  ConflictError,
  NotFoundError,
  RateLimitedError,
  stickerArchived,
} from '@/server/errors';
import { consumeFixedWindow } from '@/server/modules/rate-limit';
import type { CreateClaimBody, StickerClaim } from '@/shared/contracts/stickers';
import {
  AWARDABLE_STICKER_KEYS,
  canAwardSticker,
  customStickerId,
  isCustomStickerKey,
  isStickerOpen,
  type StickerRef,
} from '@/shared/lib/stickers';

import { claimCodeFor, verifyClaimCode } from './claim-code';
import { assertCanCreateClaim } from './policies';
import {
  closeClaimRow,
  committeeBelongsToClub,
  countClaimRedemptions,
  createClaimRow,
  findClaim,
  findClaimByVerifiedId,
  findClubCustomStickersForAwards,
  findClubForStickers,
  findClubName,
  findClubClaims,
  redeemClaimRow,
  type ClaimRow,
  type CustomStickerRow,
} from './repository';
import { toCustomDef } from './service';

/*
 * Event codes (docs/adr/0034-album-claims-and-seasons.md): a leader makes one for a sticker, a
 * limit and a time; whoever scans it while it is open gets the sticker, once.
 */

const notAllowed = () => new AuthzError('sticker_claim_not_allowed');

const REDEEM_LIMIT = { name: 'sticker-claim-redeem', max: 20, windowSeconds: 60 } as const;

function statusOf(row: ClaimRow, claimed: number, now: Date): StickerClaim['status'] {
  if (row.closedAt !== null) return 'closed';
  if (row.expiresAt <= now) return 'expired';
  if (claimed >= row.maxClaims) return 'full';
  return 'open';
}

function toClaim(
  row: ClaimRow,
  claimed: number,
  customs: ReadonlyMap<string, CustomStickerRow>,
  now: Date,
): StickerClaim {
  const custom = isCustomStickerKey(row.badgeKey) ? customs.get(row.badgeKey) : undefined;
  return {
    id: row.id,
    clubId: row.clubId,
    committeeId: row.committeeId,
    key: row.badgeKey as StickerRef,
    custom: custom ? toCustomDef(custom) : null,
    title: row.title,
    maxClaims: row.maxClaims,
    claimed,
    expiresAt: row.expiresAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    status: statusOf(row, claimed, now),
    createdAt: row.createdAt.toISOString(),
  };
}

async function customsOf(clubId: string): Promise<Map<string, CustomStickerRow>> {
  const rows = await findClubCustomStickersForAwards(clubId);
  return new Map(rows.map((row) => [`custom:${row.id}`, row]));
}

/** Who may see and stop a code: officers and full admins any, a lead their own. */
function canManageClaim(actor: Actor, claim: Pick<ClaimRow, 'clubId' | 'createdById'>): boolean {
  return (
    actor.isFullAdmin || canManageClub(actor, claim.clubId) || claim.createdById === actor.userId
  );
}

/** A sticker that may be given now, or the refusal that says why not. */
function assertGivable(row: CustomStickerRow | undefined, now: Date): void {
  if (!row) throw new NotFoundError('Sticker');
  if (row.archivedAt !== null) throw stickerArchived();
  if (!isStickerOpen(now, row)) {
    throw new ConflictError('The sticker is not open for giving now.', 'sticker_not_available');
  }
}

export async function createClaim(
  actor: Actor,
  clubId: string,
  body: CreateClaimBody,
  now = new Date(),
): Promise<StickerClaim> {
  const club = await findClubForStickers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  const customs = await customsOf(club.id);
  const custom = isCustomStickerKey(body.key) ? customs.get(body.key) : undefined;

  if (isCustomStickerKey(body.key)) {
    if (!custom) throw new NotFoundError('Sticker');
  } else if (!(AWARDABLE_STICKER_KEYS as readonly string[]).includes(body.key)) {
    // A rule gives that one: there is nothing to hand out.
    throw notAllowed();
  }
  if (body.committeeId !== null && !(await committeeBelongsToClub(body.committeeId, club.id))) {
    throw new NotFoundError('Committee');
  }
  assertCanCreateClaim(actor, club.id, body.committeeId, {
    // The standing of a lead, whatever else they are: an officer passes before this is read.
    allowedForLead: custom
      ? custom.awardableBy === 'LEAD'
      : canAwardSticker({ fullAdmin: false, officer: false, lead: true }, body.key as never),
  });
  if (club.archivedAt !== null) throw clubArchived();
  if (isCustomStickerKey(body.key)) assertGivable(custom, now);

  const created = await createClaimRow(clubsScope(actor), {
    clubId: club.id,
    committeeId: body.committeeId,
    badgeKey: body.key,
    title: body.title,
    maxClaims: body.maxClaims,
    expiresAt: new Date(now.getTime() + body.minutes * 60_000),
    createdById: actor.userId,
    createdAt: now,
  });
  if (!created) throw new NotFoundError('Club');
  return toClaim(created, 0, customs, now);
}

export async function listClaims(
  actor: Actor,
  clubId: string,
  now = new Date(),
): Promise<{ claims: StickerClaim[] }> {
  const club = await findClubForStickers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  const sees = actor.isFullAdmin || canManageClub(actor, club.id);
  const rows = await findClubClaims(clubsScope(actor), club.id, sees ? null : actor.userId);
  // A person with no standing to make codes has none of their own, so the list is empty, not refused.
  const [counts, customs] = await Promise.all([
    countClaimRedemptions(rows.map((row) => row.id)),
    customsOf(club.id),
  ]);
  return { claims: rows.map((row) => toClaim(row, counts.get(row.id) ?? 0, customs, now)) };
}

async function loadManagedClaim(actor: Actor, claimId: string): Promise<ClaimRow> {
  const claim = await findClaim(clubsScope(actor), claimId);
  if (!claim) throw new NotFoundError('Claim');
  if (!canManageClaim(actor, claim)) throw notAllowed();
  return claim;
}

export async function closeClaim(
  actor: Actor,
  claimId: string,
  now = new Date(),
): Promise<StickerClaim> {
  const claim = await loadManagedClaim(actor, claimId);
  if (!(await closeClaimRow(clubsScope(actor), claim.id, now))) throw new NotFoundError('Claim');
  const fresh = await findClaim(clubsScope(actor), claim.id);
  if (!fresh) throw new NotFoundError('Claim');
  const counts = await countClaimRedemptions([fresh.id]);
  return toClaim(fresh, counts.get(fresh.id) ?? 0, await customsOf(fresh.clubId), now);
}

/** The code to show on the screen now. A code that has closed or run out shows nothing to scan. */
export async function getClaimCode(
  actor: Actor,
  claimId: string,
  now = new Date(),
): Promise<{ code: string; refreshInSeconds: number }> {
  const claim = await loadManagedClaim(actor, claimId);
  if (claim.closedAt !== null || claim.expiresAt <= now) {
    throw new ConflictError('The code is closed.', 'claim_expired');
  }
  return claimCodeFor(claim.id, now);
}

/**
 * Scanning a code. The limit is counted first, so a wrong code costs what a right one costs; a
 * code that is wrong, or older than the last minute, is one 404 whatever is wrong with it.
 */
export async function redeemClaim(
  actor: Actor,
  code: string,
  now = new Date(),
): Promise<{
  key: StickerRef;
  custom: ReturnType<typeof toCustomDef> | null;
  title: string;
  clubName: string;
}> {
  const { exceeded, retryAfterSeconds } = await consumeFixedWindow(REDEEM_LIMIT, actor.userId, now);
  if (exceeded) throw new RateLimitedError('too_many_requests', retryAfterSeconds);

  const claimId = verifyClaimCode(code, now);
  const claim = claimId === null ? null : await findClaimByVerifiedId(claimId);
  if (!claim) throw new NotFoundError('Claim');
  if (claim.closedAt !== null || claim.expiresAt <= now) {
    throw new ConflictError('The code has ended.', 'claim_expired');
  }

  const membership = actor.memberships.find((held) => held.clubId === claim.clubId);
  if (!membership) throw new AuthzError('claim_not_for_you');
  if (
    claim.committeeId !== null &&
    !membership.committees.some((entry) => entry.committeeId === claim.committeeId)
  ) {
    throw new AuthzError('claim_not_for_you');
  }

  const club = await findClubName(claim.clubId);
  if (!club) throw new NotFoundError('Claim');
  if (club.archivedAt !== null) throw clubArchived();

  const customs = await customsOf(claim.clubId);
  const custom = isCustomStickerKey(claim.badgeKey) ? customs.get(claim.badgeKey) : undefined;
  if (isCustomStickerKey(claim.badgeKey)) assertGivable(custom, now);

  const outcome = await redeemClaimRow({
    claimId: claim.id,
    membershipId: membership.membershipId,
    clubId: claim.clubId,
    badgeKey: claim.badgeKey,
    awardedById: claim.createdById,
    reason: claim.title,
    cap:
      custom && custom.maxHolders !== null
        ? {
            stickerId: customStickerId(claim.badgeKey as `custom:${string}`),
            max: custom.maxHolders,
          }
        : null,
    now,
  });
  if (outcome === 'closed') throw new ConflictError('The code has ended.', 'claim_expired');
  if (outcome === 'full') throw new ConflictError('Everyone it was for has claimed.', 'claim_full');
  if (outcome === 'already_claimed') {
    throw new ConflictError('You already claimed this code.', 'already_claimed');
  }
  if (outcome === 'already_holds') {
    throw new ConflictError('You already hold this sticker.', 'already_holds');
  }
  if (outcome === 'sold_out') {
    throw new ConflictError('The sticker has no places left.', 'sticker_sold_out');
  }
  return {
    key: claim.badgeKey as StickerRef,
    custom: custom ? toCustomDef(custom) : null,
    title: claim.title,
    clubName: club.name,
  };
}
