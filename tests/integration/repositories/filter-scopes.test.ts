import { beforeAll, describe, expect, it } from 'vitest';

import {
  committeeMembershipsScope,
  committeeViewMembersScope,
  committeeViewPointsScope,
  membersScope,
} from '@/server/authz';
import { db } from '@/server/db/client';
import {
  findCommitteeViewMember,
  findCommitteeViewTransactions,
  searchCommitteeViewMembers,
  sumCommitteeViewBalances,
} from '@/server/modules/clubs/repository';
import { findMemberSortKeys, findMembersPage } from '@/server/modules/members/repository';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';

/*
 * The members list's filters apply the actor's scope inside the query, not only in the service
 * that validates them.
 *
 * The service refuses a committee the actor cannot see with a 404 before the query runs, so these
 * cannot be reached through the API today. They are the second line of defence — and the one that
 * still holds when something reuses `MemberFilters` without the service's resolver, which the CSV
 * export is meant to do (docs/adr/0020-members-list-filtering.md).
 */
let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});

describe('the list filters apply the scope themselves', () => {
  let scopes: {
    members: ReturnType<typeof membersScope>;
    nested: ReturnType<typeof committeeMembershipsScope>;
  };

  beforeAll(async () => {
    const lead = await actorFor(s.users.leadA1.id);
    scopes = { members: membersScope(lead), nested: committeeMembershipsScope(lead) };
  });

  const filters = (committeeId: string) => ({ committeeId, status: 'active' as const });
  const page = { skip: 0, take: 100 };
  const order = { sort: 'fullName' as const, order: 'asc' as const };

  it('finds nobody through a committee the actor does not lead', async () => {
    // leadA1 leads A1 and is a plain member of A2, where memberA2 and bothClubs also sit.
    const result = await findMembersPage(
      scopes.members,
      scopes.nested,
      filters(s.committees.a2.id),
      order,
      page,
    );
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('finds nobody through another club’s committee', async () => {
    const result = await findMembersPage(
      scopes.members,
      scopes.nested,
      filters(s.committees.b1.id),
      order,
      page,
    );
    expect(result.total).toBe(0);
  });

  it('applies the same scope to the sort keys the points ranking reads', async () => {
    await expect(
      findMemberSortKeys(scopes.members, scopes.nested, filters(s.committees.a2.id)),
    ).resolves.toEqual([]);
  });

  it('control: through the committee they do lead, it finds its members', async () => {
    const result = await findMembersPage(
      scopes.members,
      scopes.nested,
      filters(s.committees.a1.id),
      order,
      page,
    );
    expect(result.total).toBeGreaterThan(0);
    await expect(
      findMemberSortKeys(scopes.members, scopes.nested, filters(s.committees.a1.id)),
    ).resolves.toHaveLength(result.total);
  });
});

/*
 * The public committee view's reads carry the committee boundary in the scope itself, so a call
 * that forgot a filter still cannot leave the committee the token named (ADR 0023). The service
 * never passes another committee's id — these call the repository directly to prove the scope is
 * what stops it, not the service.
 */
describe('the view-link scopes hold the committee boundary', () => {
  it('searches names inside one committee only', async () => {
    // "عضو" is in every name the scenario builds, so the search matches on name alone.
    await expect(
      searchCommitteeViewMembers(committeeViewMembersScope(s.committees.a1.id), 'عضو', 20),
    ).resolves.toEqual([expect.objectContaining({ fullName: 'عضو أ1' })]);
    await expect(
      searchCommitteeViewMembers(committeeViewMembersScope(s.committees.b1.id), 'عضو أ1', 20),
    ).resolves.toEqual([]);
  });

  it('finds a member by public id only through their own committee', async () => {
    const member = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA1 },
      select: { user: { select: { publicId: true } } },
    });
    const publicId = member.user.publicId;

    await expect(
      findCommitteeViewMember(committeeViewMembersScope(s.committees.a1.id), publicId),
    ).resolves.toMatchObject({ publicId });
    for (const committee of [s.committees.a2, s.committees.b1]) {
      await expect(
        findCommitteeViewMember(committeeViewMembersScope(committee.id), publicId),
      ).resolves.toBeNull();
    }
  });

  it('sums and lists only the committee’s own active transactions', async () => {
    // bothClubs earns 7 in committee أ2 and 9 in ب1; each scope sees one of them.
    const inA2 = committeeViewPointsScope(s.committees.a2.id);
    await expect(sumCommitteeViewBalances(inA2, [s.memberships.bothClubsA])).resolves.toEqual(
      new Map([[s.memberships.bothClubsA, 7]]),
    );
    await expect(sumCommitteeViewBalances(inA2, [s.memberships.bothClubsB])).resolves.toEqual(
      new Map(),
    );

    const page = await findCommitteeViewTransactions(inA2, s.memberships.bothClubsA, {
      skip: 0,
      take: 20,
    });
    expect(page.rows.map((row) => row.amount)).toEqual([7]);
  });

  it('reaches no cancelled transaction, whatever it is asked for', async () => {
    await db.pointTransaction.update({
      where: { id: s.transactions.bothClubsA2 },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: s.users.officerA.id,
        cancellationReason: 'خطأ في الإدخال',
      },
    });
    const inA2 = committeeViewPointsScope(s.committees.a2.id);

    await expect(sumCommitteeViewBalances(inA2, [s.memberships.bothClubsA])).resolves.toEqual(
      new Map(),
    );
    const page = await findCommitteeViewTransactions(inA2, s.memberships.bothClubsA, {
      skip: 0,
      take: 20,
    });
    expect(page).toEqual({ rows: [], total: 0 });
  });
});
