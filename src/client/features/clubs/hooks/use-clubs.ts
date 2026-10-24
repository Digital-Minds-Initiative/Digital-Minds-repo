'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { meQueryKey } from '@/client/features/auth';
import { apiClient } from '@/client/lib/api-client';
import {
  archiveClubEndpoint,
  archiveCommitteeEndpoint,
  createClubEndpoint,
  createCommitteeEndpoint,
  createMembershipTypeEndpoint,
  deleteMembershipTypeEndpoint,
  disableCommitteeViewLinkEndpoint,
  getCommitteeViewLinkEndpoint,
  listClubsEndpoint,
  listCommitteesEndpoint,
  listMembershipTypesEndpoint,
  reorderMembershipTypesEndpoint,
  restoreClubEndpoint,
  restoreCommitteeEndpoint,
  rotateCommitteeViewLinkEndpoint,
  updateClubEndpoint,
  updateCommitteeEndpoint,
  updateMembershipTypeEndpoint,
  type CreateClubBody,
  type CommitteeViewLink,
  type CreateCommitteeBody,
  type MembershipType,
  type UpdateClubBody,
  type UpdateCommitteeBody,
} from '@/shared/contracts/clubs';
import { listMembersEndpoint } from '@/shared/contracts/members';

/** Query keys for this module. Every server-side parameter is part of the key. */
const clubsKeys = {
  all: ['clubs'] as const,
  list: (includeArchived: boolean) => [...clubsKeys.all, 'list', { includeArchived }] as const,
  committees: (clubId: string, includeArchived: boolean) =>
    [...clubsKeys.all, 'committees', clubId, { includeArchived }] as const,
  types: (clubId: string) => [...clubsKeys.all, 'types', clubId] as const,
  viewLink: (committeeId: string) => [...clubsKeys.all, 'view-link', committeeId] as const,
};

export function useClubs(includeArchived: boolean) {
  return useQuery({
    queryKey: clubsKeys.list(includeArchived),
    queryFn: ({ signal }) =>
      apiClient.request(listClubsEndpoint, { query: { includeArchived } }, { signal }),
  });
}

export function useCommittees(clubId: string, includeArchived: boolean) {
  return useQuery({
    queryKey: clubsKeys.committees(clubId, includeArchived),
    queryFn: ({ signal }) =>
      apiClient.request(
        listCommitteesEndpoint,
        { params: { clubId }, query: { includeArchived } },
        { signal },
      ),
  });
}

export function useMembershipTypes(clubId: string) {
  return useQuery({
    queryKey: clubsKeys.types(clubId),
    queryFn: ({ signal }) =>
      apiClient.request(listMembershipTypesEndpoint, { params: { clubId } }, { signal }),
  });
}

/**
 * What changed here is also what the rest of the dashboard offers: the member filters and the
 * navigation read `/me`, and the members table shows type and committee names. So a change
 * refreshes those too.
 */
function refreshAfterChange(queryClient: QueryClient, members = false): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: clubsKeys.all }),
    queryClient.invalidateQueries({ queryKey: meQueryKey }),
    members ? queryClient.invalidateQueries({ queryKey: ['members'] }) : undefined,
  ]);
}

export function useCreateClub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateClubBody) => apiClient.request(createClubEndpoint, { body }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useUpdateClub(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClubBody) =>
      apiClient.request(updateClubEndpoint, { params: { clubId }, body }),
    onSuccess: () => refreshAfterChange(queryClient, true),
  });
}

export function useSetClubArchived(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      apiClient.request(archived ? archiveClubEndpoint : restoreClubEndpoint, {
        params: { clubId },
      }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useCreateCommittee(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCommitteeBody) =>
      apiClient.request(createCommitteeEndpoint, { params: { clubId }, body }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useUpdateCommittee(committeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCommitteeBody) =>
      apiClient.request(updateCommitteeEndpoint, { params: { committeeId }, body }),
    onSuccess: () => refreshAfterChange(queryClient, true),
  });
}

export function useSetCommitteeArchived(committeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      apiClient.request(archived ? archiveCommitteeEndpoint : restoreCommitteeEndpoint, {
        params: { committeeId },
      }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useCreateMembershipType(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiClient.request(createMembershipTypeEndpoint, { params: { clubId }, body: { name } }),
    // Adding a type changes the list the next reorder must send in full.
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useRenameMembershipType(membershipTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiClient.request(updateMembershipTypeEndpoint, {
        params: { membershipTypeId },
        body: { name },
      }),
    onSuccess: () => refreshAfterChange(queryClient, true),
  });
}

export function useDeleteMembershipType(membershipTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moveMembersTo: string | undefined) =>
      apiClient.request(deleteMembershipTypeEndpoint, {
        params: { membershipTypeId },
        query: { moveMembersTo },
      }),
    // The order was renumbered and members may have moved, so everything is read again.
    onSuccess: () => refreshAfterChange(queryClient, true),
  });
}

/**
 * Sends the whole new order. The list shows the new order at once and goes back if the request
 * fails; afterwards it is always read again, because a rejected order (`order_mismatch`) means the
 * list changed under us and the next reorder needs the current one.
 */
export function useReorderMembershipTypes(clubId: string) {
  const queryClient = useQueryClient();
  const key = clubsKeys.types(clubId);
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.request(reorderMembershipTypesEndpoint, { params: { clubId }, body: { ids } }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: MembershipType[] }>(key);
      if (previous) {
        const byId = new Map(previous.items.map((type) => [type.id, type]));
        queryClient.setQueryData(key, {
          items: ids.flatMap((id, order) => {
            const type = byId.get(id);
            return type ? [{ ...type, order }] : [];
          }),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, rollback) => {
      if (rollback?.previous) queryClient.setQueryData(key, rollback.previous);
    },
    onSettled: () => refreshAfterChange(queryClient),
  });
}

/**
 * How many active members a club — or one of its committees — has, as the server lets this person
 * see them: the members list asked for one row, of which only the total is used. It is stored under
 * the `members` key, so adding, removing or moving a member refreshes it.
 */
export function useMemberTotal(filter: { clubId: string; committeeId?: string }) {
  return useQuery({
    queryKey: ['members', 'total', filter] as const,
    queryFn: async ({ signal }) => {
      const result = await apiClient.request(
        listMembersEndpoint,
        {
          query: {
            page: 1,
            pageSize: 1,
            sort: 'fullName',
            order: 'asc',
            clubId: filter.clubId,
            ...(filter.committeeId ? { committeeId: filter.committeeId } : {}),
            status: 'active',
          },
        },
        { signal },
      );
      return result.total;
    },
  });
}

/** The committee's view-only link (docs/adr/0023-committee-view-link.md). */
export function useCommitteeViewLink(committeeId: string, enabled: boolean) {
  return useQuery({
    queryKey: clubsKeys.viewLink(committeeId),
    queryFn: ({ signal }) =>
      apiClient.request(getCommitteeViewLinkEndpoint, { params: { committeeId } }, { signal }),
    enabled,
  });
}

/** Creates the link, or renews it: the answer is the new link, so the cache takes it as is. */
export function useRotateCommitteeViewLink(committeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.request(rotateCommitteeViewLinkEndpoint, { params: { committeeId } }),
    onSuccess: (link) => queryClient.setQueryData(clubsKeys.viewLink(committeeId), link),
  });
}

export function useDisableCommitteeViewLink(committeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.request(disableCommitteeViewLinkEndpoint, { params: { committeeId } }),
    onSuccess: () =>
      queryClient.setQueryData<CommitteeViewLink>(clubsKeys.viewLink(committeeId), {
        url: null,
        token: null,
        createdAt: null,
      }),
  });
}
