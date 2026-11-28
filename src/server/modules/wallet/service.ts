import 'server-only';

import { ownMembershipsScope, type Actor } from '@/server/authz';
import { env } from '@/server/env';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import {
  buildClubAlbum,
  getMyCardExtras,
  placeMyStickers,
  renewMyCardLink,
  updateMyCardChoices,
} from '@/server/modules/cards';
import { getOwnPointFacts } from '@/server/modules/points';
import type { UpdateMyCardBody } from '@/shared/contracts/cards';
import type { MemberCard, WalletArtName } from '@/shared/contracts/wallet';
import {
  CARD_STAMPS_TOTAL,
  cardMoodForClub,
  cardYears,
  memberCodeForMembership,
  stampIsHalf,
  stampsForPoints,
} from '@/shared/lib/member-card';
import type { StickerPlacement } from '@/shared/lib/stickers';

import { buildGoogleSaveUrl } from './google-wallet';
import { buildPkpass } from './pass/build';
import { HERO_SIZE, markSquare, stripArt } from './pass/images';
import { findCardRows } from './repository';

/** Google asks for a logo of at least 660 x 660 px, square and full bleed (it masks it to a circle itself). */
const GOOGLE_LOGO_SIZE = 660;

/** The caller's own cards: one per active club membership, with their own points, stickers and QR. */
export async function listMyCards(
  actor: Actor,
  now = new Date(),
): Promise<{ cards: MemberCard[] }> {
  const [rows, pointFacts] = await Promise.all([
    findCardRows(ownMembershipsScope(actor)),
    getOwnPointFacts(actor),
  ]);
  const years = cardYears(now);

  const base = rows.map((row) => {
    const fact = pointFacts.get(row.id) ?? { balance: 0, transactions: 0 };
    return {
      row,
      points: fact.balance,
      transactions: fact.transactions,
      ledCommittees: row.committeeMemberships
        .filter((entry) => entry.role === 'LEAD')
        .map((entry) => entry.committee.name),
    };
  });
  const extras = await getMyCardExtras(
    actor,
    base.map((item) => ({
      membershipId: item.row.id,
      clubRole: item.row.role,
      ledCommittees: item.ledCommittees,
      points: item.points,
      transactions: item.transactions,
    })),
    now,
  );

  return {
    cards: base.flatMap(({ row, points, ledCommittees }) => {
      const extra = extras.get(row.id);
      if (!extra) return [];
      const memberCode = memberCodeForMembership(row.id);
      return [
        {
          membershipId: row.id,
          club: row.club,
          mood: cardMoodForClub(row.club.slug),
          memberCode,
          fullName: row.user.fullName,
          role: row.membershipType.name,
          clubRole: row.role,
          committees: row.committeeMemberships.map((entry) => entry.committee.name),
          ledCommittees,
          ...years,
          points,
          stampsEarned: stampsForPoints(points),
          stampsHalf: stampIsHalf(points),
          stampsTotal: CARD_STAMPS_TOTAL,
          tone: extra.tone,
          tonePreference: extra.tonePreference,
          stickers: extra.stickers,
          lockedStickers: extra.lockedStickers,
          share: extra.share,
          qr: extra.share.url ?? memberCode,
          wallet: { apple: env.WALLET !== null, google: env.GOOGLE_WALLET !== null },
        },
      ];
    }),
  };
}

/** The card of one of the caller's own memberships, or a 404 like any id outside the scope. */
async function findMyCard(actor: Actor, membershipId: string, now: Date): Promise<MemberCard> {
  const { cards } = await listMyCards(actor, now);
  const card = cards.find((candidate) => candidate.membershipId === membershipId);
  if (!card) throw new NotFoundError('Membership');
  return card;
}

/** The album of one of the caller's own memberships: every sticker its club has, held or still to get. */
export async function getMyAlbum(actor: Actor, membershipId: string, now = new Date()) {
  const card = await findMyCard(actor, membershipId, now);
  return buildClubAlbum(card.club.id, new Set(card.stickers.map((sticker) => sticker.key)), now);
}

/** Changes the card's colour or what its QR page shows; answers the card as it is now. */
export async function updateMyCard(
  actor: Actor,
  membershipId: string,
  body: UpdateMyCardBody,
  now = new Date(),
): Promise<MemberCard> {
  await findMyCard(actor, membershipId, now);
  await updateMyCardChoices(actor, membershipId, body, now);
  return findMyCard(actor, membershipId, now);
}

/**
 * Where the stickers lie. Each one has to be earned: a sticker the person does not hold is a 422
 * that names it, so the back of a card cannot show a claim nobody made.
 */
export async function placeStickers(
  actor: Actor,
  membershipId: string,
  placements: readonly StickerPlacement[],
  now = new Date(),
): Promise<MemberCard> {
  const card = await findMyCard(actor, membershipId, now);
  const earned = new Set(card.stickers.map((sticker) => sticker.key));
  const refused = placements.flatMap((placement, index) =>
    earned.has(placement.key)
      ? []
      : [
          {
            path: ['body', 'placements', index, 'key'],
            code: 'sticker_not_earned',
            message: 'The member has not earned that sticker.',
          },
        ],
  );
  if (refused.length > 0) throw new ValidationError(refused);
  await placeMyStickers(actor, membershipId, placements, now);
  return findMyCard(actor, membershipId, now);
}

/** A new link for the QR; the old one answers 404 from now on. */
export async function renewCardLink(
  actor: Actor,
  membershipId: string,
  now = new Date(),
): Promise<MemberCard> {
  await findMyCard(actor, membershipId, now);
  await renewMyCardLink(actor, membershipId, now);
  return findMyCard(actor, membershipId, now);
}

/**
 * The signed Wallet pass for one of the caller's own memberships. Another person's membership, or
 * one the caller left, is a 404 like any id outside the scope; without the Apple certificate it
 * is 409 `wallet_not_configured`.
 */
export async function getMyWalletPass(
  actor: Actor,
  membershipId: string,
  now = new Date(),
): Promise<{ bytes: Buffer; filename: string }> {
  const card = await findMyCard(actor, membershipId, now);
  if (env.WALLET === null) {
    throw new ConflictError(
      'Apple Wallet passes are not set up on this server.',
      'wallet_not_configured',
    );
  }
  return {
    bytes: buildPkpass(card, env.WALLET, env.APP_ORIGIN),
    filename: `digital-minds-${card.club.slug}.pkpass`,
  };
}

/**
 * The "Save to Google Wallet" address for one of the caller's own memberships (Android, and any
 * browser signed in to a Google account). 409 `wallet_not_configured` without the issuer account.
 */
export async function getMyGoogleWalletUrl(
  actor: Actor,
  membershipId: string,
  now = new Date(),
): Promise<{ url: string }> {
  const card = await findMyCard(actor, membershipId, now);
  if (env.GOOGLE_WALLET === null) {
    throw new ConflictError(
      'Google Wallet passes are not set up on this server.',
      'wallet_not_configured',
    );
  }
  return { url: buildGoogleSaveUrl(card, env.GOOGLE_WALLET, env.APP_ORIGIN, now) };
}

/**
 * One of the badge's pictures, by name: the gradient hero or the pixel-head logo of one of the
 * four colourways. Nothing in it is personal, which is why a wallet may fetch it without signing in.
 */
export function getWalletArt(name: WalletArtName): Buffer {
  const [kind, tone, mood] = name.split('-') as [
    'hero' | 'logo',
    'paper' | 'matte',
    'tech' | 'gem',
  ];
  const variant = `${tone}-${mood}` as const;
  return kind === 'hero'
    ? stripArt(variant, HERO_SIZE.width, HERO_SIZE.height).toPng({ alpha: false })
    : markSquare(variant, GOOGLE_LOGO_SIZE).toPng({ alpha: false });
}
