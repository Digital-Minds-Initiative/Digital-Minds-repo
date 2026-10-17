'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { apiClient } from '@/client/lib/api-client';
import { listMembershipTypesEndpoint } from '@/shared/contracts/clubs';
import { listMembersEndpoint, type ListMembersQueryInput } from '@/shared/contracts/members';
import { listClubPermissionsEndpoint } from '@/shared/contracts/permissions';

/** The total of a members list asked for one row: only the count is used. */
async function totalOf(
  filter: Pick<ListMembersQueryInput, 'clubId' | 'registered'>,
  signal: AbortSignal,
): Promise<number> {
  const result = await apiClient.request(
    listMembersEndpoint,
    {
      query: {
        page: 1,
        pageSize: 1,
        sort: 'fullName',
        order: 'asc',
        status: 'active',
        ...(filter.clubId ? { clubId: filter.clubId } : {}),
        ...(filter.registered === undefined ? {} : { registered: filter.registered }),
      },
    },
    { signal },
  );
  return result.total;
}

/**
 * How many active members the person can see — all of them, those who have signed up and those
 * who have not — for one club or for every club in their scope. Three counts of the members list,
 * so they agree with the table and respect what the server lets this person see. Stored under the
 * `members` key, so adding, editing or removing a member refreshes them.
 */
export function useMemberCounts(clubId: string | undefined) {
  return useQuery({
    queryKey: ['members', 'stats', clubId ?? null] as const,
    queryFn: async ({ signal }) => {
      const [total, registered, pending] = await Promise.all([
        totalOf({ clubId }, signal),
        totalOf({ clubId, registered: true }, signal),
        totalOf({ clubId, registered: false }, signal),
      ]);
      return { total, registered, pending };
    },
  });
}

/**
 * How many different people hold a management role — club officer or committee lead — in the given
 * clubs. Who holds which role is on the permissions endpoint, which only the clubs' officers and
 * full admins may read, so this is asked only for clubs the person manages.
 */
export function useRoleHolderCount(clubIds: readonly string[]) {
  return useQuery({
    queryKey: ['permissions', 'holder-count', [...clubIds].sort()] as const,
    queryFn: async ({ signal }) => {
      const clubs = await Promise.all(
        clubIds.map((clubId) =>
          apiClient.request(listClubPermissionsEndpoint, { params: { clubId } }, { signal }),
        ),
      );
      const people = new Set<string>();
      for (const club of clubs) {
        for (const officer of club.officers) people.add(officer.memberId);
        for (const lead of club.leads) people.add(lead.memberId);
      }
      return people.size;
    },
    enabled: clubIds.length > 0,
  });
}

/**
 * How many membership types each club has, by club id. The type badges in the table are drawn by
 * the place on the club's ladder, and the last place needs the count. Uses the keys the clubs
 * screen uses, so the lists are shared and refreshed together.
 */
export function useTypeCounts(clubIds: readonly string[]): ReadonlyMap<string, number> {
  // Folded into text: the same numbers give the same map, so the table's columns are not rebuilt
  // (and its cells remounted) by every render.
  const counts = useQueries({
    queries: clubIds.map((clubId) => ({
      queryKey: ['clubs', 'types', clubId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.request(listMembershipTypesEndpoint, { params: { clubId } }, { signal }),
    })),
    combine: (results) =>
      results
        .flatMap((result, index) =>
          result.data ? [`${clubIds[index] ?? ''}:${result.data.items.length}`] : [],
        )
        .join(','),
  });
  return useMemo(
    () =>
      new Map(
        counts
          .split(',')
          .filter(Boolean)
          .map((pair) => {
            const [clubId = '', count = '0'] = pair.split(':');
            return [clubId, Number(count)] as const;
          }),
      ),
    [counts],
  );
}
