'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { meQueryKey } from '@/client/features/auth';
import { apiClient } from '@/client/lib/api-client';
import { listCommitteesEndpoint } from '@/shared/contracts/clubs';
import { listMembersEndpoint } from '@/shared/contracts/members';
import {
  listClubPermissionsEndpoint,
  listRoleHistoryEndpoint,
  setClubRoleEndpoint,
  setCommitteeRoleEndpoint,
} from '@/shared/contracts/permissions';

/** Query keys for this module. Every server-side parameter is part of the key. */
const permissionsKeys = {
  all: ['permissions'] as const,
  holders: (clubId: string) => [...permissionsKeys.all, 'holders', clubId] as const,
  history: (clubId: string, page: number) =>
    [...permissionsKeys.all, 'history', clubId, page] as const,
  committees: (clubId: string) => [...permissionsKeys.all, 'committees', clubId] as const,
  candidates: (clubId: string, committeeId: string | undefined, q: string) =>
    [...permissionsKeys.all, 'candidates', clubId, committeeId ?? null, q] as const,
};

/** Who holds officer and lead roles in a club. */
export function useClubPermissions(clubId: string) {
  return useQuery({
    queryKey: permissionsKeys.holders(clubId),
    queryFn: ({ signal }) =>
      apiClient.request(listClubPermissionsEndpoint, { params: { clubId } }, { signal }),
  });
}

const HISTORY_PAGE_SIZE = 10;

/** The club's grants and revokes, newest first. */
export function useRoleHistory(clubId: string, page: number) {
  return useQuery({
    queryKey: permissionsKeys.history(clubId, page),
    queryFn: ({ signal }) =>
      apiClient.request(
        listRoleHistoryEndpoint,
        { params: { clubId }, query: { page, pageSize: HISTORY_PAGE_SIZE } },
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

/** The club's active committees, so a committee without a lead is listed too. */
export function useClubCommittees(clubId: string) {
  return useQuery({
    queryKey: permissionsKeys.committees(clubId),
    queryFn: ({ signal }) =>
      apiClient.request(
        listCommitteesEndpoint,
        { params: { clubId }, query: { includeArchived: false } },
        { signal },
      ),
  });
}

/**
 * Members a role can be given to: active members of the club — or of one committee, for a lead —
 * matching a name or email search.
 */
export function useCandidates(clubId: string, committeeId: string | undefined, q: string) {
  return useQuery({
    queryKey: permissionsKeys.candidates(clubId, committeeId, q),
    queryFn: ({ signal }) =>
      apiClient.request(
        listMembersEndpoint,
        {
          query: {
            clubId,
            ...(committeeId ? { committeeId: [committeeId] } : {}),
            ...(q ? { q } : {}),
            status: 'active',
            page: 1,
            pageSize: 8,
            sort: 'fullName',
            order: 'asc',
          },
        },
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * A role change moves who holds what, adds a history row, and changes what the changed person can
 * do on their very next request — so these lists, the members table's role column and the
 * dashboard's own access (`/me`) are all read again.
 */
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: permissionsKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['members'] }),
      queryClient.invalidateQueries({ queryKey: meQueryKey }),
    ]);
}

export function useSetClubRole() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: 'MEMBER' | 'CLUB_OFFICER' }) =>
      apiClient.request(setClubRoleEndpoint, { params: { memberId }, body: { role } }),
    onSettled: refresh,
  });
}

export function useSetCommitteeRole() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({
      memberId,
      committeeId,
      role,
    }: {
      memberId: string;
      committeeId: string;
      role: 'MEMBER' | 'LEAD';
    }) =>
      apiClient.request(setCommitteeRoleEndpoint, {
        params: { memberId, committeeId },
        body: { role },
      }),
    onSettled: refresh,
  });
}
