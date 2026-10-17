import { beforeAll, describe, expect, it } from 'vitest';

import { committeeMembershipsScope, membersScope } from '@/server/authz';
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
describe('the list filters apply the scope themselves', () => {
  let s: Scenario;
  let scopes: {
    members: ReturnType<typeof membersScope>;
    nested: ReturnType<typeof committeeMembershipsScope>;
  };

  beforeAll(async () => {
    s = await buildScenario();
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
