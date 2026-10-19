import {
  canSeeCommittee,
  findMockActor,
  getMockDb,
  type MockCommittee,
  type MockDb,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  disableCommitteeViewLinkEndpoint,
  getCommitteeViewLinkEndpoint,
  publicCommitteeViewEndpoint,
  publicMemberPointsEndpoint,
  PUBLIC_MEMBER_SEARCH_LIMIT,
  rotateCommitteeViewLinkEndpoint,
  searchPublicCommitteeMembersEndpoint,
  VIEW_LINK_PATH,
  type CommitteeViewLink,
} from '@/shared/contracts/clubs';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import { demoViewToken } from '@/shared/demo/ids';
import { normalizeForSearch } from '@/shared/lib/arabic';

/*
 * The committee view link and the public page it opens (docs/adr/0023-committee-view-link.md),
 * mocked so both sides can be built without a server: the copy and renew controls in the
 * dashboard, and the public page itself.
 *
 * The mock keeps the token in plain text — there is nothing to protect in a browser fixture — but
 * it follows every rule the real module follows: who may manage a link, that renewing kills the
 * old token at once, that an archived club or committee refuses the writes, that all four dead
 * tokens answer the same 404, and that the public answers carry nothing but their own fields.
 *
 * The limits are deliberately not mocked: 60 requests a minute is not something a person reaches
 * by hand, and a mock that refused them would only get in the way of building the page.
 */

const NO_LINK: CommitteeViewLink = { url: null, token: null, createdAt: null };

const conflict = (reason: string, message: string) => mockError('CONFLICT', message, { reason });

/** The whole link. The server builds it from APP_ORIGIN; the mock takes the request's own. */
function toViewLink(committee: MockCommittee, request: Request): CommitteeViewLink {
  if (!committee.viewLink) return NO_LINK;
  return {
    url: `${new URL(request.url).origin}${VIEW_LINK_PATH}/${committee.viewLink.token}`,
    token: committee.viewLink.token,
    createdAt: committee.viewLink.createdAt,
  };
}

let rotations = 0;

/** A new 32-character token, deterministic per call so the demo stays reproducible. */
function newToken(): string {
  rotations += 1;
  return demoViewToken(`rotation:${String(rotations)}:${String(Date.now())}`);
}

interface ManagedCommittee {
  db: MockDb;
  committee: MockCommittee;
}

/**
 * The committee a managing request names, or a 404. There is no 403 here, for the same reason
 * the real service cannot produce one: whoever can see a committee can manage its link.
 */
function manageable(
  cookies: Record<string, string>,
  committeeId: string,
): ManagedCommittee | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  if (!actor) return mockError('UNAUTHENTICATED');

  const committee = db.committeesById.get(committeeId);
  if (!committee || !canSeeCommittee(actor, committee.clubId, committee.id)) {
    return mockError('NOT_FOUND');
  }
  return { db, committee };
}

const failed = <T extends object>(value: T | MockError): value is MockError => 'code' in value;

/** Archived clubs and committees accept no new link, and no change to the one they have. */
function archived(db: MockDb, committee: MockCommittee): MockError | null {
  const club = db.clubsById.get(committee.clubId);
  if (club?.archivedAt) return conflict('club_archived', 'The club is archived.');
  if (committee.archivedAt) return conflict('committee_archived', 'The committee is archived.');
  return null;
}

// ─── The public side ────────────────────────────────────────

interface PublicCommittee {
  db: MockDb;
  committee: MockCommittee;
}

/**
 * The committee a token opens. Unknown, renewed, turned off, archived: one and the same 404, as
 * on the server.
 */
function opened(token: string): PublicCommittee | MockError {
  const db = getMockDb();
  const committee = db.committees.find((candidate) => candidate.viewLink?.token === token);
  if (!committee || committee.archivedAt) return mockError('NOT_FOUND');
  if (db.clubsById.get(committee.clubId)?.archivedAt) return mockError('NOT_FOUND');
  return { db, committee };
}

/** Active members of the committee, with their balance in it. */
function committeeMembers(db: MockDb, committee: MockCommittee) {
  return db.memberships
    .filter(
      (membership) =>
        membership.removedAt === null &&
        membership.committees.some((row) => row.committeeId === committee.id && !row.removed),
    )
    .map((membership) => {
      const user = db.usersById.get(membership.userId);
      return {
        membershipId: membership.id,
        publicId: user?.publicId ?? '',
        fullName: user?.fullName ?? '',
        balance: db.transactions
          .filter(
            (transaction) =>
              transaction.membershipId === membership.id &&
              transaction.committeeId === committee.id &&
              transaction.status === 'ACTIVE',
          )
          .reduce((sum, transaction) => sum + transaction.amount, 0),
      };
    });
}

export const viewLinkHandlers = [
  mockEndpoint(getCommitteeViewLinkEndpoint, ({ cookies, params, request }) => {
    const found = manageable(cookies, params.committeeId);
    if (failed(found)) return found;
    return toViewLink(found.committee, request);
  }),

  mockEndpoint(rotateCommitteeViewLinkEndpoint, ({ cookies, params, request }) => {
    const found = manageable(cookies, params.committeeId);
    if (failed(found)) return found;
    const refused = archived(found.db, found.committee);
    if (refused) return refused;

    found.committee.viewLink = { token: newToken(), createdAt: new Date().toISOString() };
    return toViewLink(found.committee, request);
  }),

  mockEndpoint(disableCommitteeViewLinkEndpoint, ({ cookies, params }) => {
    const found = manageable(cookies, params.committeeId);
    if (failed(found)) return found;
    const refused = archived(found.db, found.committee);
    if (refused) return refused;

    found.committee.viewLink = null;
    return undefined;
  }),

  mockEndpoint(publicCommitteeViewEndpoint, ({ params }) => {
    const found = opened(params.token);
    if (failed(found)) return found;
    return {
      committee: { name: found.committee.name },
      club: { name: found.db.clubsById.get(found.committee.clubId)?.name ?? '' },
    };
  }),

  mockEndpoint(searchPublicCommitteeMembersEndpoint, ({ params, query }) => {
    const found = opened(params.token);
    if (failed(found)) return found;

    const search = normalizeForSearch(query.q);
    const items = committeeMembers(found.db, found.committee)
      .filter((member) => normalizeForSearch(member.fullName).includes(search))
      .sort((a, b) => normalizeForSearch(a.fullName).localeCompare(normalizeForSearch(b.fullName)))
      .slice(0, PUBLIC_MEMBER_SEARCH_LIMIT);

    return {
      items: items.map((member) => ({
        publicId: member.publicId,
        fullName: member.fullName,
        balance: member.balance,
      })),
    };
  }),

  mockEndpoint(publicMemberPointsEndpoint, ({ params, query }) => {
    const found = opened(params.token);
    if (failed(found)) return found;

    const member = committeeMembers(found.db, found.committee).find(
      (candidate) => candidate.publicId === params.publicId,
    );
    // A removed member, or one of another committee, is not here — and is a 404 like any other.
    if (!member) return mockError('NOT_FOUND');

    const transactions = found.db.transactions
      .filter(
        (transaction) =>
          transaction.membershipId === member.membershipId &&
          transaction.committeeId === found.committee.id &&
          transaction.status === 'ACTIVE',
      )
      .sort(
        (a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt),
      );

    const { skip, take } = pageOffset(query.page, query.pageSize);
    return {
      member: { publicId: member.publicId, fullName: member.fullName },
      balance: member.balance,
      transactions: {
        items: transactions.slice(skip, skip + take).map((transaction) => ({
          amount: transaction.amount,
          reason: transaction.reason,
          workDate: transaction.workDate,
        })),
        ...pageMeta(transactions.length, query.page, query.pageSize),
      },
    };
  }),
];
