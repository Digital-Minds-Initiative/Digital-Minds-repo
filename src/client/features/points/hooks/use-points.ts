'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import { listMembersEndpoint } from '@/shared/contracts/members';
import {
  cancelPointTransactionEndpoint,
  clubPointsBulkEndpoint,
  committeePointsBulkEndpoint,
  createPointTransactionEndpoint,
  getMemberPointsEndpoint,
  listPointTransactionRevisionsEndpoint,
  updatePointTransactionEndpoint,
  type CancelPointTransactionBody,
  type ClubPointsBulkBody,
  type CommitteePointsBulkBody,
  type CreatePointTransactionBody,
  type MemberPointsQuery,
  type UpdatePointTransactionBody,
} from '@/shared/contracts/points';

/** Query keys for this module. Every server-side parameter is part of the key. */
const pointsKeys = {
  all: ['points'] as const,
  member: (memberId: string, query: MemberPointsQuery) =>
    [...pointsKeys.all, 'member', memberId, query] as const,
  revisions: (transactionId: string) => [...pointsKeys.all, 'revisions', transactionId] as const,
};

/** A member's balances and one page of their transactions. */
export function useMemberPoints(memberId: string, query: MemberPointsQuery) {
  return useQuery({
    queryKey: pointsKeys.member(memberId, query),
    queryFn: ({ signal }) =>
      apiClient.request(getMemberPointsEndpoint, { params: { memberId }, query }, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** The API's largest page; a committee is read whole, page after page, up to `MAX_PAGES`. */
const PAGE = 100;
const MAX_PAGES = 20;

/**
 * The active members of one committee, each with the points they have in it. This is the members
 * list with the committee filter — the points of a committee are on the member (`committees[]`),
 * limited by the server to the committees the caller may see — so the page can search and sort the
 * whole committee without an endpoint of its own.
 */
export function useCommitteeMembers(committeeId: string, clubId: string) {
  return useQuery({
    queryKey: ['members', 'committee-points', committeeId] as const,
    queryFn: async ({ signal }) => {
      const members = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await apiClient.request(
          listMembersEndpoint,
          {
            query: {
              page,
              pageSize: PAGE,
              sort: 'fullName',
              order: 'asc',
              clubId,
              committeeId,
              status: 'active',
            },
          },
          { signal },
        );
        members.push(...result.items);
        if (page >= result.pageCount) break;
      }
      return members;
    },
    enabled: committeeId !== '',
    placeholderData: keepPreviousData,
  });
}

/** The story of one transaction. Only fetched once someone asks to see it. */
export function useRevisions(transactionId: string, enabled: boolean) {
  return useQuery({
    queryKey: pointsKeys.revisions(transactionId),
    queryFn: ({ signal }) =>
      apiClient.request(
        listPointTransactionRevisionsEndpoint,
        { params: { transactionId } },
        { signal },
      ),
    enabled,
  });
}

/**
 * A change to the ledger changes the member's balances, every page of the history, a revision
 * list, and the points of the members lists — so all of them are read again.
 */
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: pointsKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['members'] }),
    ]);
}

export function useAddPoints(memberId: string) {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({
      committeeId,
      body,
    }: {
      committeeId: string;
      body: CreatePointTransactionBody;
    }) =>
      apiClient.request(createPointTransactionEndpoint, {
        params: { memberId, committeeId },
        body,
      }),
    onSuccess: refresh,
  });
}

export function useEditPoints() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({
      transactionId,
      body,
    }: {
      transactionId: string;
      body: UpdatePointTransactionBody;
    }) => apiClient.request(updatePointTransactionEndpoint, { params: { transactionId }, body }),
    // Even a refused edit (`transaction_modified`) means the list on screen is stale.
    onSettled: refresh,
  });
}

export function useCancelPoints() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({
      transactionId,
      body,
    }: {
      transactionId: string;
      body: CancelPointTransactionBody;
    }) => apiClient.request(cancelPointTransactionEndpoint, { params: { transactionId }, body }),
    onSettled: refresh,
  });
}

/**
 * Points for several members of one committee at once. Nothing is written when any of them is
 * refused (422 `entries_rejected`), so only a success changes the lists.
 */
export function useCommitteeBulkPoints(committeeId: string) {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (body: CommitteePointsBulkBody) =>
      apiClient.request(committeePointsBulkEndpoint, { params: { committeeId }, body }),
    onSuccess: refresh,
  });
}

/** The same across the committees of one club: (member, committee) pairs. */
export function useClubBulkPoints(clubId: string) {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (body: ClubPointsBulkBody) =>
      apiClient.request(clubPointsBulkEndpoint, { params: { clubId }, body }),
    onSuccess: refresh,
  });
}

/** Every active member of a club, with their committees, read whole — for the club-wide batch. */
export function useClubMembers(clubId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['members', 'club-roster', clubId] as const,
    queryFn: async ({ signal }) => {
      const members = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await apiClient.request(
          listMembersEndpoint,
          {
            query: {
              page,
              pageSize: PAGE,
              sort: 'fullName',
              order: 'asc',
              clubId,
              status: 'active',
            },
          },
          { signal },
        );
        members.push(...result.items);
        if (page >= result.pageCount) break;
      }
      return members;
    },
    enabled,
  });
}
