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
  stampsForPoints,
} from '@/shared/lib/member-card';
import {
  AWARDABLE_STICKER_KEYS,
  canAwardSticker,
  derivedStickers,
  STICKER_KEYS,
  STICKER_RULES,
  type StickerKey,
  type StickerPlacement,
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

interface MockCards {
  cards: Map<string, CardState>;
  awards: Map<string, Map<StickerKey, string>>;
}

const stores = new WeakMap<MockDb, MockCards>();

function storeFor(db: MockDb): MockCards {
  let store = stores.get(db);
  if (!store) {
    store = { cards: new Map(), awards: new Map() };
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
    const state = storeFor(db).cards.get(membership.id);
    if (state && tokenFor(membership.id, state.tokenVersion) === token) return membership;
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

function stickersOf(db: MockDb, membership: MockMembership) {
  const facts = factsOf(db, membership);
  const state = cardStateFor(db, membership.id);
  const awarded = storeFor(db).awards.get(membership.id) ?? new Map<StickerKey, string>();
  const earned = new Set<StickerKey>(
    derivedStickers({
      clubRole: facts.clubRole,
      ledCommittees: facts.ledCommittees.length,
      points: facts.points,
      transactions: facts.transactions,
    }),
  );
  for (const key of AWARDABLE_STICKER_KEYS) if (awarded.has(key)) earned.add(key);
  return STICKER_KEYS.filter((key) => earned.has(key)).map((key) => ({
    key,
    source: STICKER_RULES[key].source,
    placement: state.placements.find((placement) => placement.key === key) ?? null,
  }));
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
    stampsTotal: CARD_STAMPS_TOTAL,
    tone:
      state.tone ?? cardToneFor({ clubRole: facts.clubRole, ledCommittees: facts.ledCommittees }),
    tonePreference: state.tone,
    stickers: stickersOf(db, membership),
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
    const held = storeFor(db).awards.get(membership.id) ?? new Map<StickerKey, string>();
    const standing = standingFor(actor, membership);
    const mayAward = actor.user.isFullAdmin || actor.user.id !== membership.userId;
    return {
      awarded: AWARDABLE_STICKER_KEYS.filter((key) => held.has(key)).map((key) => ({
        key,
        awardedAt: held.get(key) ?? new Date().toISOString(),
        revocable: mayAward && canAwardSticker(standing, key),
      })),
      awardable: mayAward
        ? AWARDABLE_STICKER_KEYS.filter((key) => !held.has(key) && canAwardSticker(standing, key))
        : [],
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
    if (!canAwardSticker(standingFor(actor, membership), body.key)) {
      return mockError('FORBIDDEN', 'This role cannot award that sticker.', {
        reason: 'sticker_award_not_allowed',
      });
    }
    if (membership.removedAt !== null) {
      return mockError('CONFLICT', 'The member was removed from this club.', {
        reason: 'member_removed',
      });
    }
    const store = storeFor(db);
    const held = store.awards.get(membership.id) ?? new Map<StickerKey, string>();
    if (!held.has(body.key)) held.set(body.key, new Date().toISOString());
    store.awards.set(membership.id, held);
    return {
      key: body.key,
      awardedAt: held.get(body.key) ?? new Date().toISOString(),
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
    if (!canAwardSticker(standingFor(actor, membership), params.key)) {
      return mockError('FORBIDDEN', 'This role cannot take that sticker back.', {
        reason: 'sticker_award_not_allowed',
      });
    }
    const held = storeFor(db).awards.get(membership.id);
    if (!held?.delete(params.key)) return notFound('Sticker');
    const state = cardStateFor(db, membership.id);
    state.placements = state.placements.filter((placement) => placement.key !== params.key);
    return undefined;
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
      thisMonth: show ? (byMonth.get(months[5] ?? '') ?? 0) : null,
      monthly: show ? months.map((month) => ({ month, points: byMonth.get(month) ?? 0 })) : null,
      stickers: stickersOf(db, membership).map(({ key, placement }) => ({ key, placement })),
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
