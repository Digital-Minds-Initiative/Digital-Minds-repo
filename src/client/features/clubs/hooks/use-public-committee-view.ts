'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import {
  PUBLIC_MEMBER_SEARCH_MIN,
  publicCommitteeViewEndpoint,
  publicMemberPointsEndpoint,
  searchPublicCommitteeMembersEndpoint,
} from '@/shared/contracts/clubs';

/*
 * The public committee view (docs/adr/0023-committee-view-link.md): no session, the token in the
 * URL is the only permission. Its keys stay apart from the dashboard's so nothing is shared.
 */

const HISTORY_PAGE_SIZE = 20;

const publicViewKeys = {
  all: (token: string) => ['public-committee-view', token] as const,
  search: (token: string, q: string) => [...publicViewKeys.all(token), 'search', q] as const,
  points: (token: string, publicId: string) =>
    [...publicViewKeys.all(token), 'points', publicId] as const,
};

export function usePublicCommitteeView(token: string, enabled: boolean) {
  return useQuery({
    queryKey: publicViewKeys.all(token),
    queryFn: ({ signal }) =>
      apiClient.request(publicCommitteeViewEndpoint, { params: { token } }, { signal }),
    enabled,
    staleTime: Infinity,
  });
}

/** Asks only once the search is long enough for the server to accept it. */
export function usePublicMemberSearch(token: string, q: string) {
  return useQuery({
    queryKey: publicViewKeys.search(token, q),
    queryFn: ({ signal }) =>
      apiClient.request(
        searchPublicCommitteeMembersEndpoint,
        { params: { token }, query: { q } },
        { signal },
      ),
    enabled: q.length >= PUBLIC_MEMBER_SEARCH_MIN,
  });
}

/** One member's balance and history, newest first, a page at a time («عرض المزيد»). */
export function usePublicMemberPoints(token: string, publicId: string) {
  return useInfiniteQuery({
    queryKey: publicViewKeys.points(token, publicId),
    queryFn: ({ pageParam, signal }) =>
      apiClient.request(
        publicMemberPointsEndpoint,
        { params: { token, publicId }, query: { page: pageParam, pageSize: HISTORY_PAGE_SIZE } },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.transactions.page < last.transactions.pageCount ? last.transactions.page + 1 : undefined,
  });
}
