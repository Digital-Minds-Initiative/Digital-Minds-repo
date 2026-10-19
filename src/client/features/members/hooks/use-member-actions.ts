'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { meQueryKey } from '@/client/features/auth';
import { apiClient } from '@/client/lib/api-client';
import { listCommitteesEndpoint, listMembershipTypesEndpoint } from '@/shared/contracts/clubs';
import {
  addMemberToCommitteeEndpoint,
  createMemberEndpoint,
  getMemberEndpoint,
  removeMemberEndpoint,
  removeMemberFromCommitteeEndpoint,
  updateMemberEndpoint,
  type CreateMemberBody,
  type UpdateMemberBody,
} from '@/shared/contracts/members';
import {
  confirmMemberImportEndpoint,
  previewMemberImportEndpoint,
} from '@/shared/contracts/members-import';

/** One member's record. Under the `members` key, so any change to a member refreshes it. */
export function useMember(memberId: string | null) {
  return useQuery({
    queryKey: ['members', 'detail', memberId] as const,
    queryFn: ({ signal }) =>
      apiClient.request(getMemberEndpoint, { params: { memberId: memberId ?? '' } }, { signal }),
    enabled: memberId !== null,
  });
}

// The same keys the clubs screen uses, so a change made there refreshes these lists too.

/** A club's membership types in their order. */
export function useClubTypes(clubId: string | undefined) {
  return useQuery({
    queryKey: ['clubs', 'types', clubId] as const,
    queryFn: ({ signal }) =>
      apiClient.request(
        listMembershipTypesEndpoint,
        { params: { clubId: clubId ?? '' } },
        { signal },
      ),
    enabled: clubId !== undefined,
  });
}

/** A club's active committees (the ones a member can be added to). */
export function useClubCommittees(clubId: string | undefined) {
  return useQuery({
    queryKey: ['clubs', 'committees', clubId, { includeArchived: false }] as const,
    queryFn: ({ signal }) =>
      apiClient.request(
        listCommitteesEndpoint,
        { params: { clubId: clubId ?? '' }, query: { includeArchived: false } },
        { signal },
      ),
    enabled: clubId !== undefined,
  });
}

/**
 * Changing a member changes the table, the member's record, the balances and ledger the points
 * page shows, who the permissions page lists, and — when the person removed or changed is the
 * signed-in one — their own access. All of them are read again.
 */
function refreshAfterChange(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [['members'], ['points'], ['permissions'], meQueryKey].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export function useCreateMember(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMemberBody) =>
      apiClient.request(createMemberEndpoint, { params: { clubId }, body }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}

export function useUpdateMember(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMemberBody) =>
      apiClient.request(updateMemberEndpoint, { params: { memberId }, body }),
    onSettled: () => refreshAfterChange(queryClient),
  });
}

export function useRemoveMember(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.request(removeMemberEndpoint, { params: { memberId } }),
    onSettled: () => refreshAfterChange(queryClient),
  });
}

export function useAddToCommittee(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (committeeId: string) =>
      apiClient.request(addMemberToCommitteeEndpoint, { params: { memberId, committeeId } }),
    onSettled: () => refreshAfterChange(queryClient),
  });
}

export function useRemoveFromCommittee(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (committeeId: string) =>
      apiClient.request(removeMemberFromCommitteeEndpoint, { params: { memberId, committeeId } }),
    onSettled: () => refreshAfterChange(queryClient),
  });
}

/** Reads a CSV and says what each row would do; writes nothing. */
export function usePreviewMemberImport(clubId: string) {
  return useMutation({
    mutationFn: (file: string) =>
      apiClient.request(previewMemberImportEndpoint, { params: { clubId }, body: { file } }),
  });
}

/** Applies the previewed file; the server refuses it (409 `import_changed`) if anything moved. */
export function useConfirmMemberImport(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, checksum }: { file: string; checksum: string }) =>
      apiClient.request(confirmMemberImportEndpoint, {
        params: { clubId },
        body: { file, checksum },
      }),
    onSuccess: () => refreshAfterChange(queryClient),
  });
}
