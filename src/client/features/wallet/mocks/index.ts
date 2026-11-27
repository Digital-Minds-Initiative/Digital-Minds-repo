import {
  canSeeMembership,
  findMockActor,
  getMockDb,
  must,
  type MockActor,
  type MockDb,
  type MockMembership,
} from '@/client/mocks/db';
import { mockEndpoint, mockError } from '@/client/mocks/endpoint';
import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  awardStickerEndpoint,
  listMemberStickersEndpoint,
  placeMyStickersEndpoint,
  publicCardEndpoint,
  renewCardLinkEndpoint,
  revokeStickerEndpoint,
  updateMyCardEndpoint,
  type PublicCard,
} from '@/shared/contracts/cards';
import {
  albumEndpoint,
  claimCodeEndpoint,
  closeClaimEndpoint,
  createClaimEndpoint,
  createCustomStickerEndpoint,
  listClaimsEndpoint,
  listCustomStickersEndpoint,
  redeemClaimEndpoint,
  stickerStatsEndpoint,
  updateCustomStickerEndpoint,
  type AlbumEntry,
  type StickerClaim,
  type StudioSticker,
} from '@/shared/contracts/stickers';
import {
  googleWalletEndpoint,
  myCardsEndpoint,
  walletPassEndpoint,
  type MemberCard,
} from '@/shared/contracts/wallet';
import { todayInAppTimeZone } from '@/shared/lib/dates';
import {
  CARD_STAMPS_TOTAL,
  cardMoodForClub,
  cardToneFor,
  cardYears,
  lastSixMonths,
  memberCodeForMembership,
  stampIsHalf,
  stampsForPoints,
} from '@/shared/lib/member-card';
import {
  AWARDABLE_STICKER_KEYS,
  BUILTIN_RARITY,
  canAwardCustomSticker,
  canAwardSticker,
  CUSTOM_STICKER_LIMITS,
  customStickerKey,
  derivedStickers,
  isCustomStickerKey,
  isHiddenBuiltin,
  isStickerOpen,
  STICKER_KEYS,
  STICKER_RULES,
  type CustomStickerDef,
  type StickerKey,
  type StickerPlacement,
  type StickerRef,
} from '@/shared/lib/stickers';
import { cardRoleLabel } from '@/shared/lib/wallet-pass';

/*
 * The member's card on mocks: the same rules as the server (src/server/modules/cards and wallet),
 * kept in memory per mock database, so a colour, a sticker or a link changed in the browser stays
 * changed until the page's data is reset. Every answer is validated against the contract by
 * `mockEndpoint`, so a mock cannot drift from the API.
 */

interface CardState {
  tone: 'paper' | 'matte' | null;
  share: { enabled: boolean; showPoints: boolean; showActivity: boolean };
  /** Bumped by a renewal, so the old link stops working. */
  tokenVersion: number;
  placements: StickerPlacement[];
}

/** One award: when it was given and what for. */
interface MockAward {
  awardedAt: string;
  reason: string | null;
}

interface MockCustomSticker {
  id: string;
  clubId: string;
  createdById: string;
  createdAt: string;
  archived: boolean;
  awardableBy: 'LEAD' | 'OFFICER';
  maxHolders: number | null;
  def: Omit<CustomStickerDef, 'key'>;
}

/** One event code in the mocks; `redeemed` holds the memberships that scanned it. */
interface MockClaim {
  id: string;
  clubId: string;
  committeeId: string | null;
  key: string;
  title: string;
  maxClaims: number;
  expiresAt: number;
  closedAt: number | null;
  createdById: string;
  createdAt: number;
  redeemed: Set<string>;
}

/** The mac every mock code carries: a real one is an HMAC, here only its shape matters. */
const MOCK_MAC = 'MOCKMOCKMOCKMOCK';

interface MockCards {
  cards: Map<string, CardState>;
  awards: Map<string, Map<string, MockAward>>;
  customs: Map<string, MockCustomSticker>;
  claims: Map<string, MockClaim>;
}

const stores = new WeakMap<MockDb, MockCards>();

function storeFor(db: MockDb): MockCards {
  let store = stores.get(db);
  if (!store) {
    store = { cards: new Map(), awards: new Map(), customs: new Map(), claims: new Map() };
    stores.set(db, store);
  }
  return store;
}

function cardStateFor(db: MockDb, membershipId: string): CardState {
  const store = storeFor(db);
  let state = store.cards.get(membershipId);
  if (!state) {
    state = {
      tone: null,
      share: { enabled: true, showPoints: true, showActivity: false },
      tokenVersion: 0,
      placements: [],
    };
    store.cards.set(membershipId, state);
  }
  return state;
}

/** 32 URL-safe characters, as a real token has: the membership's hex id with its first character set by the version. */
function tokenFor(membershipId: string, version: number): string {
  return `${(version % 36).toString(36)}${membershipId.replaceAll('-', '').slice(1)}`;
}

function membershipByToken(db: MockDb, token: string): MockMembership | null {
  for (const membership of db.memberships) {
    // A card nobody has listed yet still has its first link, as a real one is made on first use.
    const version = storeFor(db).cards.get(membership.id)?.tokenVersion ?? 0;
    if (tokenFor(membership.id, version) === token) return membership;
  }
  return null;
}

function factsOf(db: MockDb, membership: MockMembership) {
  const active = db.transactions.filter(
    (tx) => tx.membershipId === membership.id && tx.status === 'ACTIVE',
  );
  const ledCommittees = membership.committees
    .filter((entry) => !entry.removed && entry.role === 'LEAD')
    .map((entry) => must(db.committeesById.get(entry.committeeId), 'committee').name);
  return {
    points: active.reduce((sum, tx) => sum + tx.amount, 0),
    transactions: active.length,
    ledCommittees,
    clubRole: membership.role === 'CLUB_OFFICER' ? ('CLUB_OFFICER' as const) : ('MEMBER' as const),
    active,
  };
}

function defOf(custom: MockCustomSticker): CustomStickerDef {
  return { key: customStickerKey(custom.id), ...custom.def };
}

function stickersOf(db: MockDb, membership: MockMembership) {
  const facts = factsOf(db, membership);
  const state = cardStateFor(db, membership.id);
  const store = storeFor(db);
  const awarded = store.awards.get(membership.id) ?? new Map<string, MockAward>();
  const earned = new Set<StickerKey>(
    derivedStickers({
      clubRole: facts.clubRole,
      ledCommittees: facts.ledCommittees.length,
      points: facts.points,
      transactions: facts.transactions,
    }),
  );
  for (const key of AWARDABLE_STICKER_KEYS) if (awarded.has(key)) earned.add(key);
  const detail = (key: string) => ({
    earnedAt: awarded.get(key)?.awardedAt ?? null,
    reason: awarded.get(key)?.reason ?? null,
  });
  const placed = (key: string) =>
    state.placements.find((placement) => placement.key === key) ?? null;
  const builtin = STICKER_KEYS.filter((key) => earned.has(key)).map((key) => ({
    key: key as StickerRef,
    source: STICKER_RULES[key].source,
    placement: placed(key),
    ...detail(key),
    custom: null,
  }));
  const customs = [...awarded.entries()]
    .filter(([key]) => isCustomStickerKey(key))
    .flatMap(([key]) => {
      const custom = store.customs.get(key.slice('custom:'.length));
      if (!custom || custom.clubId !== membership.clubId) return [];
      return [
        {
          key: key as StickerRef,
          source: 'awarded' as const,
          placement: placed(key),
          ...detail(key),
          custom: defOf(custom),
        },
      ];
    });
  return [...builtin, ...customs];
}

/** The club's visible, live custom stickers this member has not earned: shown locked in the tray. */
function lockedOf(db: MockDb, membership: MockMembership): CustomStickerDef[] {
  const store = storeFor(db);
  const held = store.awards.get(membership.id) ?? new Map<string, MockAward>();
  return [...store.customs.values()]
    .filter(
      (custom) =>
        custom.clubId === membership.clubId &&
        !custom.archived &&
        !custom.def.hidden &&
        !held.has(customStickerKey(custom.id)),
    )
    .map(defOf);
}

function buildCard(db: MockDb, actor: MockActor, membership: MockMembership): MemberCard {
  const club = must(db.clubsById.get(membership.clubId), 'club');
  const facts = factsOf(db, membership);
  const state = cardStateFor(db, membership.id);
  const memberCode = memberCodeForMembership(membership.id);
  const url = state.share.enabled
    ? `http://localhost:3000/c/${tokenFor(membership.id, state.tokenVersion)}`
    : null;
  return {
    membershipId: membership.id,
    club: { id: club.id, name: club.name, slug: club.slug },
    mood: cardMoodForClub(club.slug),
    memberCode,
    fullName: actor.user.fullName,
    role: must(db.membershipTypesById.get(membership.typeId), 'membership type').name,
    clubRole: facts.clubRole,
    committees: membership.committees
      .filter((entry) => !entry.removed)
      .map((entry) => must(db.committeesById.get(entry.committeeId), 'committee').name)
      .sort((a, b) => a.localeCompare(b, 'ar')),
    ledCommittees: [...facts.ledCommittees].sort((a, b) => a.localeCompare(b, 'ar')),
    ...cardYears(new Date()),
    points: facts.points,
    stampsEarned: stampsForPoints(facts.points),
    stampsHalf: stampIsHalf(facts.points),
    stampsTotal: CARD_STAMPS_TOTAL,
    tone:
      state.tone ?? cardToneFor({ clubRole: facts.clubRole, ledCommittees: facts.ledCommittees }),
    tonePreference: state.tone,
    stickers: stickersOf(db, membership),
    lockedStickers: lockedOf(db, membership),
    share: { ...state.share, url },
    qr: url ?? memberCode,
    wallet: { apple: false, google: false },
  };
}

function ownMembership(db: MockDb, actor: MockActor, membershipId: string): MockMembership | null {
  return (
    db.memberships.find(
      (membership) =>
        membership.id === membershipId &&
        membership.userId === actor.user.id &&
        membership.removedAt === null,
    ) ?? null
  );
}

/** The actor behind the dev cookie, or the 401 the server gives. */
function actorOf(cookies: Record<string, string>) {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  return { db, actor };
}

function standingFor(actor: MockActor, membership: MockMembership) {
  return {
    fullAdmin: actor.user.isFullAdmin,
    officer: actor.user.isFullAdmin || actor.officerClubIds.includes(membership.clubId),
    lead: membership.committees.some(
      (entry) => !entry.removed && actor.ledCommitteeIds.includes(entry.committeeId),
    ),
  };
}

const notFound = (what: string) => mockError('NOT_FOUND', `${what} not found.`);
const denied = () =>
  mockError('FORBIDDEN', 'You cannot design stickers here.', {
    reason: 'sticker_design_not_allowed',
  });

const canSeeClub = (actor: MockActor, clubId: string) =>
  actor.user.isFullAdmin ||
  getMockDb().memberships.some(
    (membership) =>
      membership.userId === actor.user.id &&
      membership.clubId === clubId &&
      membership.removedAt === null,
  );

/** Officers, full admins and the leads of the club's committees may design stickers. */
function canDesign(actor: MockActor, clubId: string): boolean {
  if (actor.user.isFullAdmin || actor.officerClubIds.includes(clubId)) return true;
  const db = getMockDb();
  return actor.ledCommitteeIds.some((id) => db.committeesById.get(id)?.clubId === clubId);
}

function canEditCustom(actor: MockActor, custom: MockCustomSticker): boolean {
  if (actor.user.isFullAdmin || actor.officerClubIds.includes(custom.clubId)) return true;
  return custom.createdById === actor.user.id && canDesign(actor, custom.clubId);
}

const claimDenied = () =>
  mockError('FORBIDDEN', 'You cannot manage this code.', { reason: 'sticker_claim_not_allowed' });

function canManageClaimMock(actor: MockActor, claim: MockClaim): boolean {
  return (
    actor.user.isFullAdmin ||
    actor.officerClubIds.includes(claim.clubId) ||
    claim.createdById === actor.user.id
  );
}

function claimOf(db: MockDb, claim: MockClaim): StickerClaim {
  const custom = isCustomStickerKey(claim.key)
    ? storeFor(db).customs.get(claim.key.slice('custom:'.length))
    : undefined;
  const claimed = claim.redeemed.size;
  const now = Date.now();
  return {
    id: claim.id,
    clubId: claim.clubId,
    committeeId: claim.committeeId,
    key: claim.key as StickerRef,
    custom: custom ? defOf(custom) : null,
    title: claim.title,
    maxClaims: claim.maxClaims,
    claimed,
    expiresAt: new Date(claim.expiresAt).toISOString(),
    closedAt: claim.closedAt === null ? null : new Date(claim.closedAt).toISOString(),
    status:
      claim.closedAt !== null
        ? 'closed'
        : claim.expiresAt <= now
          ? 'expired'
          : claimed >= claim.maxClaims
            ? 'full'
            : 'open',
    createdAt: new Date(claim.createdAt).toISOString(),
  };
}

function studioOf(db: MockDb, actor: MockActor, custom: MockCustomSticker): StudioSticker {
  const key = customStickerKey(custom.id);
  const heldBy = [...storeFor(db).awards.values()].filter((held) => held.has(key)).length;
  return {
    ...defOf(custom),
    id: custom.id,
    clubId: custom.clubId,
    awardableBy: custom.awardableBy,
    maxHolders: custom.maxHolders,
    archived: custom.archived,
    createdAt: custom.createdAt,
    heldBy,
    canEdit: canEditCustom(actor, custom),
  };
}

export const walletHandlers = [
  mockEndpoint(myCardsEndpoint, ({ cookies }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const cards = db.memberships
      .filter((membership) => membership.userId === actor.user.id && membership.removedAt === null)
      .map((membership) => buildCard(db, actor, membership))
      .sort((a, b) => a.club.name.localeCompare(b.club.name, 'ar'));
    return { cards };
  }),

  mockEndpoint(updateMyCardEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = ownMembership(db, actor, params.membershipId);
    if (!membership) return notFound('Membership');
    const state = cardStateFor(db, membership.id);
    if (body.tone !== undefined) state.tone = body.tone;
    if (body.share) {
      if (body.share.enabled !== undefined) state.share.enabled = body.share.enabled;
      if (body.share.showPoints !== undefined) state.share.showPoints = body.share.showPoints;
      if (body.share.showActivity !== undefined) state.share.showActivity = body.share.showActivity;
    }
    return buildCard(db, actor, membership);
  }),

  mockEndpoint(placeMyStickersEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = ownMembership(db, actor, params.membershipId);
    if (!membership) return notFound('Membership');
    const earned = new Set(stickersOf(db, membership).map((sticker) => sticker.key));
    const refused = body.placements.flatMap((placement, index) =>
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
    if (refused.length > 0) {
      return mockError('VALIDATION_FAILED', 'A sticker was not earned.', { issues: refused });
    }
    cardStateFor(db, membership.id).placements = body.placements;
    return buildCard(db, actor, membership);
  }),

  mockEndpoint(renewCardLinkEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = ownMembership(db, actor, params.membershipId);
    if (!membership) return notFound('Membership');
    cardStateFor(db, membership.id).tokenVersion += 1;
    return buildCard(db, actor, membership);
  }),

  mockEndpoint(walletPassEndpoint, ({ cookies }) => {
    const { actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    return mockError('CONFLICT', 'Apple Wallet passes are not set up on this server.', {
      reason: 'wallet_not_configured',
    });
  }),

  mockEndpoint(googleWalletEndpoint, ({ cookies }) => {
    const { actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    return mockError('CONFLICT', 'Google Wallet passes are not set up on this server.', {
      reason: 'wallet_not_configured',
    });
  }),

  // ─── Awards ─────────────────────────────────────────────────

  mockEndpoint(listMemberStickersEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((candidate) => candidate.id === params.memberId);
    if (!membership || !canSeeMembership(actor, membership)) return notFound('Member');
    const store = storeFor(db);
    const held = store.awards.get(membership.id) ?? new Map<string, MockAward>();
    const standing = standingFor(actor, membership);
    const mayAward = actor.user.isFullAdmin || actor.user.id !== membership.userId;
    const customs = [...store.customs.values()].filter(
      (custom) => custom.clubId === membership.clubId,
    );
    const awardedCustom = customs.filter((custom) => held.has(customStickerKey(custom.id)));
    const awardableCustom = mayAward
      ? customs.filter(
          (custom) =>
            !custom.archived &&
            !held.has(customStickerKey(custom.id)) &&
            canAwardCustomSticker(standing, custom.awardableBy),
        )
      : [];
    return {
      awarded: [
        ...AWARDABLE_STICKER_KEYS.filter((key) => held.has(key)).map((key) => ({
          key: key as StickerRef,
          awardedAt: held.get(key)?.awardedAt ?? new Date().toISOString(),
          reason: held.get(key)?.reason ?? null,
          revocable: mayAward && canAwardSticker(standing, key),
        })),
        ...awardedCustom.map((custom) => ({
          key: customStickerKey(custom.id) as StickerRef,
          awardedAt: held.get(customStickerKey(custom.id))?.awardedAt ?? new Date().toISOString(),
          reason: held.get(customStickerKey(custom.id))?.reason ?? null,
          revocable: mayAward && canAwardCustomSticker(standing, custom.awardableBy),
        })),
      ],
      awardable: [
        ...(mayAward
          ? AWARDABLE_STICKER_KEYS.filter((key) => !held.has(key) && canAwardSticker(standing, key))
          : []),
        ...awardableCustom.map((custom) => customStickerKey(custom.id) as StickerRef),
      ],
      custom: [...awardedCustom, ...awardableCustom].map(defOf),
    };
  }),

  mockEndpoint(awardStickerEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((candidate) => candidate.id === params.memberId);
    if (!membership || !canSeeMembership(actor, membership)) return notFound('Member');
    if (!actor.user.isFullAdmin && actor.user.id === membership.userId) {
      return mockError('FORBIDDEN', 'Nobody awards their own sticker.', {
        reason: 'cannot_award_self',
      });
    }
    const standing = standingFor(actor, membership);
    const store = storeFor(db);
    if (isCustomStickerKey(body.key)) {
      const custom = store.customs.get(body.key.slice('custom:'.length));
      if (!custom || custom.clubId !== membership.clubId) return notFound('Sticker');
      if (!canAwardCustomSticker(standing, custom.awardableBy)) {
        return mockError('FORBIDDEN', 'This role cannot award that sticker.', {
          reason: 'sticker_award_not_allowed',
        });
      }
      if (custom.archived) {
        return mockError('CONFLICT', 'The sticker is archived.', { reason: 'sticker_archived' });
      }
      if (!isStickerOpen(new Date(), custom.def)) {
        return mockError('CONFLICT', 'The sticker is not open for giving now.', {
          reason: 'sticker_not_available',
        });
      }
      const heldNow = [...store.awards.values()].filter((held) => held.has(body.key)).length;
      const mineAlready = store.awards.get(membership.id)?.has(body.key) ?? false;
      if (custom.maxHolders !== null && !mineAlready && heldNow >= custom.maxHolders) {
        return mockError('CONFLICT', 'The sticker has no places left.', {
          reason: 'sticker_sold_out',
        });
      }
    } else if (!canAwardSticker(standing, body.key as StickerKey)) {
      return mockError('FORBIDDEN', 'This role cannot award that sticker.', {
        reason: 'sticker_award_not_allowed',
      });
    }
    if (membership.removedAt !== null) {
      return mockError('CONFLICT', 'The member was removed from this club.', {
        reason: 'member_removed',
      });
    }
    const held = store.awards.get(membership.id) ?? new Map<string, MockAward>();
    if (!held.has(body.key)) {
      held.set(body.key, { awardedAt: new Date().toISOString(), reason: body.reason ?? null });
    }
    store.awards.set(membership.id, held);
    const award = held.get(body.key);
    return {
      key: body.key,
      awardedAt: award?.awardedAt ?? new Date().toISOString(),
      reason: award?.reason ?? null,
      revocable: true,
    };
  }),

  mockEndpoint(revokeStickerEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((candidate) => candidate.id === params.memberId);
    if (!membership || !canSeeMembership(actor, membership)) return notFound('Member');
    if (!actor.user.isFullAdmin && actor.user.id === membership.userId) {
      return mockError('FORBIDDEN', 'Nobody changes their own stickers.', {
        reason: 'cannot_award_self',
      });
    }
    const standing = standingFor(actor, membership);
    const store = storeFor(db);
    const allowed = isCustomStickerKey(params.key)
      ? (() => {
          const custom = store.customs.get(params.key.slice('custom:'.length));
          return custom !== undefined && canAwardCustomSticker(standing, custom.awardableBy);
        })()
      : canAwardSticker(standing, params.key as StickerKey);
    if (!allowed) {
      return mockError('FORBIDDEN', 'This role cannot take that sticker back.', {
        reason: 'sticker_award_not_allowed',
      });
    }
    const held = store.awards.get(membership.id);
    if (!held?.delete(params.key)) return notFound('Sticker');
    const state = cardStateFor(db, membership.id);
    state.placements = state.placements.filter((placement) => placement.key !== params.key);
    return undefined;
  }),

  // ─── The sticker studio ─────────────────────────────────────

  mockEndpoint(listCustomStickersEndpoint, ({ cookies, params, query }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    if (!canSeeClub(actor, params.clubId)) return notFound('Club');
    if (!canDesign(actor, params.clubId)) return denied();
    const store = storeFor(db);
    return {
      stickers: [...store.customs.values()]
        .filter((custom) => custom.clubId === params.clubId)
        .filter((custom) => query.includeArchived === true || !custom.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((custom) => studioOf(db, actor, custom)),
    };
  }),

  mockEndpoint(createCustomStickerEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    if (!canSeeClub(actor, params.clubId)) return notFound('Club');
    if (!canDesign(actor, params.clubId)) return denied();
    const club = must(db.clubsById.get(params.clubId), 'club');
    if (club.archivedAt !== null) {
      return mockError('CONFLICT', 'The club is archived.', { reason: 'club_archived' });
    }
    const store = storeFor(db);
    const live = [...store.customs.values()].filter(
      (custom) => custom.clubId === params.clubId && !custom.archived,
    );
    if (live.length >= CUSTOM_STICKER_LIMITS.perClub) {
      return mockError('CONFLICT', 'Too many stickers.', { reason: 'sticker_limit_reached' });
    }
    const { awardableBy, maxHolders, ...def } = body;
    const custom: MockCustomSticker = {
      id: crypto.randomUUID(),
      clubId: params.clubId,
      createdById: actor.user.id,
      createdAt: new Date().toISOString(),
      archived: false,
      awardableBy,
      maxHolders,
      def,
    };
    store.customs.set(custom.id, custom);
    return studioOf(db, actor, custom);
  }),

  mockEndpoint(updateCustomStickerEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const custom = storeFor(db).customs.get(params.stickerId);
    if (!custom || !canSeeClub(actor, custom.clubId)) return notFound('Sticker');
    if (!canEditCustom(actor, custom)) return denied();
    const { archived, awardableBy, maxHolders, ...fields } = body;
    custom.def = {
      ...custom.def,
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    };
    if (awardableBy !== undefined) custom.awardableBy = awardableBy;
    if (maxHolders !== undefined) custom.maxHolders = maxHolders;
    if (archived !== undefined) custom.archived = archived;
    return studioOf(db, actor, custom);
  }),

  // ─── The album, event codes and a sticker's numbers ─────────

  mockEndpoint(albumEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = ownMembership(db, actor, params.membershipId);
    if (!membership) return notFound('Membership');
    const store = storeFor(db);
    const heldKeys = new Set<string>(stickersOf(db, membership).map((sticker) => sticker.key));
    const clubMembers = db.memberships.filter(
      (member) => member.clubId === membership.clubId && member.removedAt === null,
    );
    const percentOf = (key: string) => {
      const holding = clubMembers.filter((member) => store.awards.get(member.id)?.has(key)).length;
      return clubMembers.length === 0 ? 0 : Math.round((holding * 100) / clubMembers.length);
    };
    const now = new Date();
    const entries: AlbumEntry[] = [];
    let secretCount = 0;
    for (const key of STICKER_KEYS) {
      const mine = heldKeys.has(key);
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
        heldPercent: given ? percentOf(key) : null,
        availableFrom: null,
        availableUntil: null,
        open: true,
      });
    }
    for (const custom of store.customs.values()) {
      if (custom.clubId !== membership.clubId) continue;
      const key = customStickerKey(custom.id);
      const mine = heldKeys.has(key);
      if ((custom.archived || custom.def.hidden) && !mine) {
        if (custom.def.hidden && !custom.archived) secretCount += 1;
        continue;
      }
      const holding = clubMembers.filter((member) => store.awards.get(member.id)?.has(key)).length;
      entries.push({
        key,
        custom: defOf(custom),
        rarity: custom.def.rarity,
        held: mine,
        heldPercent: percentOf(key),
        availableFrom: custom.def.availableFrom,
        availableUntil: custom.def.availableUntil,
        open:
          !custom.archived &&
          isStickerOpen(now, custom.def) &&
          (custom.maxHolders === null || holding < custom.maxHolders),
      });
    }
    return { entries, secretCount };
  }),

  mockEndpoint(createClaimEndpoint, ({ cookies, params, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    if (!canSeeClub(actor, params.clubId)) return notFound('Club');
    const club = must(db.clubsById.get(params.clubId), 'club');
    const isOfficer = actor.user.isFullAdmin || actor.officerClubIds.includes(params.clubId);
    const store = storeFor(db);
    const custom = isCustomStickerKey(body.key)
      ? store.customs.get(body.key.slice('custom:'.length))
      : undefined;
    if (isCustomStickerKey(body.key) && (!custom || custom.clubId !== params.clubId)) {
      return notFound('Sticker');
    }
    const leadAllowed = custom
      ? custom.awardableBy === 'LEAD'
      : canAwardSticker({ fullAdmin: false, officer: false, lead: true }, body.key as StickerKey);
    const leads = body.committeeId !== null && actor.ledCommitteeIds.includes(body.committeeId);
    if (!isOfficer && !(leads && leadAllowed)) {
      return mockError('FORBIDDEN', 'You cannot make codes for this.', {
        reason: 'sticker_claim_not_allowed',
      });
    }
    if (club.archivedAt !== null) {
      return mockError('CONFLICT', 'The club is archived.', { reason: 'club_archived' });
    }
    if (custom?.archived) {
      return mockError('CONFLICT', 'The sticker is archived.', { reason: 'sticker_archived' });
    }
    const now = Date.now();
    const claim: MockClaim = {
      id: crypto.randomUUID(),
      clubId: params.clubId,
      committeeId: body.committeeId,
      key: body.key,
      title: body.title,
      maxClaims: body.maxClaims,
      expiresAt: now + body.minutes * 60_000,
      closedAt: null,
      createdById: actor.user.id,
      createdAt: now,
      redeemed: new Set(),
    };
    store.claims.set(claim.id, claim);
    return claimOf(db, claim);
  }),

  mockEndpoint(listClaimsEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    if (!canSeeClub(actor, params.clubId)) return notFound('Club');
    const sees = actor.user.isFullAdmin || actor.officerClubIds.includes(params.clubId);
    return {
      claims: [...storeFor(db).claims.values()]
        .filter((claim) => claim.clubId === params.clubId)
        .filter((claim) => sees || claim.createdById === actor.user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((claim) => claimOf(db, claim)),
    };
  }),

  mockEndpoint(closeClaimEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const claim = storeFor(db).claims.get(params.claimId);
    if (!claim || !canSeeClub(actor, claim.clubId)) return notFound('Claim');
    if (!canManageClaimMock(actor, claim)) return claimDenied();
    claim.closedAt ??= Date.now();
    return claimOf(db, claim);
  }),

  mockEndpoint(claimCodeEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const claim = storeFor(db).claims.get(params.claimId);
    if (!claim || !canSeeClub(actor, claim.clubId)) return notFound('Claim');
    if (!canManageClaimMock(actor, claim)) return claimDenied();
    if (claim.closedAt !== null || claim.expiresAt <= Date.now()) {
      return mockError('CONFLICT', 'The code is closed.', { reason: 'claim_expired' });
    }
    const window = Math.floor(Date.now() / 60_000);
    return {
      code: `${claim.id}.${window.toString(36)}.${MOCK_MAC}`,
      refreshInSeconds: 60 - Math.floor((Date.now() % 60_000) / 1000),
    };
  }),

  mockEndpoint(redeemClaimEndpoint, ({ cookies, body }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const [claimId = '', windowText = '', mac = ''] = body.code.split('.');
    const store = storeFor(db);
    const claim = store.claims.get(claimId);
    const window = Number.parseInt(windowText, 36);
    const current = Math.floor(Date.now() / 60_000);
    if (!claim || mac !== MOCK_MAC || window > current || window < current - 1) {
      return notFound('Claim');
    }
    if (claim.closedAt !== null || claim.expiresAt <= Date.now()) {
      return mockError('CONFLICT', 'The code has ended.', { reason: 'claim_expired' });
    }
    const membership = db.memberships.find(
      (held) =>
        held.userId === actor.user.id && held.clubId === claim.clubId && held.removedAt === null,
    );
    if (
      !membership ||
      (claim.committeeId !== null &&
        !membership.committees.some(
          (entry) => !entry.removed && entry.committeeId === claim.committeeId,
        ))
    ) {
      return mockError('FORBIDDEN', 'This code is not for you.', { reason: 'claim_not_for_you' });
    }
    const custom = isCustomStickerKey(claim.key)
      ? store.customs.get(claim.key.slice('custom:'.length))
      : undefined;
    if (custom?.archived) {
      return mockError('CONFLICT', 'The sticker is archived.', { reason: 'sticker_archived' });
    }
    if (custom && !isStickerOpen(new Date(), custom.def)) {
      return mockError('CONFLICT', 'The sticker is not open for giving now.', {
        reason: 'sticker_not_available',
      });
    }
    if (claim.redeemed.size >= claim.maxClaims) {
      return mockError('CONFLICT', 'Everyone it was for has claimed.', { reason: 'claim_full' });
    }
    if (claim.redeemed.has(membership.id)) {
      return mockError('CONFLICT', 'You already claimed this code.', { reason: 'already_claimed' });
    }
    const held = store.awards.get(membership.id) ?? new Map<string, MockAward>();
    if (held.has(claim.key)) {
      return mockError('CONFLICT', 'You already hold this sticker.', { reason: 'already_holds' });
    }
    if (custom && custom.maxHolders !== null) {
      const holding = [...store.awards.values()].filter((entry) => entry.has(claim.key)).length;
      if (holding >= custom.maxHolders) {
        return mockError('CONFLICT', 'The sticker has no places left.', {
          reason: 'sticker_sold_out',
        });
      }
    }
    held.set(claim.key, { awardedAt: new Date().toISOString(), reason: claim.title });
    store.awards.set(membership.id, held);
    claim.redeemed.add(membership.id);
    return {
      key: claim.key as StickerRef,
      custom: custom ? defOf(custom) : null,
      title: claim.title,
      clubName: must(db.clubsById.get(claim.clubId), 'club').name,
    };
  }),

  mockEndpoint(stickerStatsEndpoint, ({ cookies, params }) => {
    const { db, actor } = actorOf(cookies);
    if (!actor) return mockError('UNAUTHENTICATED');
    const custom = storeFor(db).customs.get(params.stickerId);
    if (!custom || !canSeeClub(actor, custom.clubId)) return notFound('Sticker');
    if (!canDesign(actor, custom.clubId)) return denied();
    const key = customStickerKey(custom.id);
    const store = storeFor(db);
    const holders = db.memberships.filter(
      (member) => member.clubId === custom.clubId && store.awards.get(member.id)?.has(key),
    );
    const members = db.memberships.filter(
      (member) => member.clubId === custom.clubId && member.removedAt === null,
    ).length;
    const placed = holders.filter((member) =>
      cardStateFor(db, member.id).placements.some((placement) => placement.key === key),
    ).length;
    const months = lastSixMonths(todayInAppTimeZone(new Date()));
    const byMonth = new Map(months.map((month) => [month, 0]));
    for (const member of holders) {
      const at = store.awards.get(member.id)?.get(key)?.awardedAt ?? '';
      const month = new Date(new Date(at).getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
      if (byMonth.has(month)) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    const pct = (part: number, whole: number) =>
      whole === 0 ? 0 : Math.min(100, Math.round((part * 100) / whole));
    return {
      heldBy: holders.length,
      percentOfMembers: pct(holders.length, members),
      placedPercent: pct(placed, holders.length),
      byMonth: months.map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
      givers: [],
    };
  }),

  // ─── The page the QR opens ──────────────────────────────────

  mockEndpoint(publicCardEndpoint, ({ params }) => {
    const db = getMockDb();
    const membership = membershipByToken(db, params.token);
    const state = membership ? cardStateFor(db, membership.id) : null;
    const club = membership ? db.clubsById.get(membership.clubId) : undefined;
    const user = membership ? db.usersById.get(membership.userId) : undefined;
    if (
      !membership ||
      !state ||
      !club ||
      !user ||
      !state.share.enabled ||
      membership.removedAt !== null ||
      user.deleted ||
      club.archivedAt !== null
    ) {
      return notFound('Page');
    }
    const facts = factsOf(db, membership);
    const months = lastSixMonths(todayInAppTimeZone(new Date()));
    const byMonth = new Map(months.map((month) => [month, 0]));
    for (const tx of facts.active) {
      const month = tx.workDate.slice(0, 7);
      if (byMonth.has(month)) byMonth.set(month, (byMonth.get(month) ?? 0) + tx.amount);
    }
    const type = must(db.membershipTypesById.get(membership.typeId), 'membership type');
    const show = state.share.showPoints;
    const page: PublicCard = {
      fullName: user.fullName,
      club: { name: club.name, slug: club.slug },
      mood: cardMoodForClub(club.slug),
      tone:
        state.tone ?? cardToneFor({ clubRole: facts.clubRole, ledCommittees: facts.ledCommittees }),
      role: cardRoleLabel(
        { clubRole: facts.clubRole, ledCommittees: facts.ledCommittees, role: type.name },
        walletPassAr,
      ),
      hijriYear: cardYears(new Date()).hijriYear,
      stampsTotal: CARD_STAMPS_TOTAL,
      points: show ? facts.points : null,
      stampsEarned: show ? stampsForPoints(facts.points) : null,
      stampsHalf: show ? stampIsHalf(facts.points) : null,
      thisMonth: show ? (byMonth.get(months[5] ?? '') ?? 0) : null,
      monthly: show ? months.map((month) => ({ month, points: byMonth.get(month) ?? 0 })) : null,
      stickers: stickersOf(db, membership).map(({ key, placement, earnedAt, reason, custom }) => ({
        key,
        placement,
        earnedAt,
        reason: state.share.showActivity ? reason : null,
        custom,
      })),
      activity:
        show && state.share.showActivity
          ? [...facts.active]
              .sort((a, b) => b.workDate.localeCompare(a.workDate))
              .slice(0, 5)
              .map((tx) => ({ workDate: tx.workDate, reason: tx.reason, amount: tx.amount }))
          : null,
    };
    return page;
  }),
];
