import 'server-only';

import { committeeViewMembersScope, committeeViewPointsScope } from '@/server/authz';
import { NotFoundError } from '@/server/errors';
import {
  PUBLIC_MEMBER_SEARCH_LIMIT,
  type PublicCommitteeView,
  type PublicMemberPoints,
  type PublicMemberPointsQuery,
  type PublicMemberSearchQuery,
  type PublicMemberSearchResult,
} from '@/shared/contracts/clubs';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import { dateToDateOnly } from '@/shared/lib/dates';

import {
  findCommitteeByViewTokenHash,
  findCommitteeViewMember,
  findCommitteeViewTransactions,
  searchCommitteeViewMembers,
  sumCommitteeViewBalances,
  type PublicCommitteeRow,
} from './repository';
import { viewTokenHash } from './view-link-token';
import { consumePublicViewLimits } from './view-rate-limits';

/*
 * The public committee view (docs/adr/0023-committee-view-link.md): the only part of the API
 * anyone can read without signing in.
 *
 * There is no Actor. The token in the URL is the whole permission, and it grants one committee:
 * resolving it yields a committee id, and every read goes through the token-derived scopes
 * (`committeeView*Scope` in src/server/authz), so no query can leave that committee.
 *
 * Everything an unknown, renewed, turned-off or archived token could mean answers the same
 * `NotFoundError`, built in one place, so the four cases cannot be told apart. The responses
 * carry only what the contracts list; `defineRoute` parses them through those schemas, which is
 * the second guarantee that nothing else can leak.
 */

/** What the route wrapper knows about the caller (`client` in src/server/http). */
interface ViewClient {
  /** From the trusted proxy header, or null when none is trusted: then no per-IP limit applies. */
  ip: string | null;
}

/** The names shown at the top of the page. */
export async function getPublicCommitteeView(
  token: string,
  client: ViewClient,
): Promise<PublicCommitteeView> {
  const committee = await resolveViewToken(token, client);
  return { committee: { name: committee.name }, club: { name: committee.club.name } };
}

/**
 * Members of the committee whose name matches. The contract already requires two characters and
 * caps the answer at twenty, so this cannot be walked to list the committee.
 */
export async function searchPublicCommitteeMembers(
  token: string,
  query: PublicMemberSearchQuery,
  client: ViewClient,
): Promise<PublicMemberSearchResult> {
  const committee = await resolveViewToken(token, client);

  const members = await searchCommitteeViewMembers(
    committeeViewMembersScope(committee.id),
    query.q,
    PUBLIC_MEMBER_SEARCH_LIMIT,
  );
  const balances = await sumCommitteeViewBalances(
    committeeViewPointsScope(committee.id),
    members.map((member) => member.id),
  );
  return {
    items: members.map((member) => ({
      publicId: member.publicId,
      fullName: member.fullName,
      balance: balances.get(member.id) ?? 0,
    })),
  };
}

/** One member's balance in this committee and the transactions behind it. */
export async function getPublicMemberPoints(
  token: string,
  publicId: string,
  query: PublicMemberPointsQuery,
  client: ViewClient,
): Promise<PublicMemberPoints> {
  const committee = await resolveViewToken(token, client);

  // Through the members scope, so a member removed from the committee or from the club is a 404
  // even when their public id is known exactly.
  const member = await findCommitteeViewMember(committeeViewMembersScope(committee.id), publicId);
  if (!member) throw notFound();

  const scope = committeeViewPointsScope(committee.id);
  const [page, balances] = await Promise.all([
    findCommitteeViewTransactions(scope, member.id, pageOffset(query.page, query.pageSize)),
    sumCommitteeViewBalances(scope, [member.id]),
  ]);
  return {
    member: { publicId: member.publicId, fullName: member.fullName },
    balance: balances.get(member.id) ?? 0,
    transactions: {
      items: page.rows.map((row) => ({
        amount: row.amount,
        reason: row.reason,
        workDate: dateToDateOnly(row.workDate),
      })),
      ...pageMeta(page.total, query.page, query.pageSize),
    },
  };
}

/**
 * The committee a token opens, or the one 404 every other case answers with.
 *
 * The limits are counted first, for every request alike: a wrong token costs what a right one
 * costs, and no case does extra work before the refusal that its timing could give away.
 */
async function resolveViewToken(token: string, client: ViewClient): Promise<PublicCommitteeRow> {
  await consumePublicViewLimits(token, client, new Date());

  const committee = await findCommitteeByViewTokenHash(viewTokenHash(token));
  // A renewed or turned-off token matches nothing; an archived committee or club closes its page.
  if (!committee || committee.archivedAt || committee.club.archivedAt) throw notFound();
  return committee;
}

/** One refusal for every reason a public view can fail, so none of them is distinguishable. */
function notFound(): NotFoundError {
  return new NotFoundError('Page');
}
