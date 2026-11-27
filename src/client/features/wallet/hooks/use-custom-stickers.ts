'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import {
  albumEndpoint,
  claimCodeEndpoint,
  closeClaimEndpoint,
  createClaimEndpoint,
  createCustomStickerEndpoint,
  listClaimsEndpoint,
  listCustomStickersEndpoint,
  redeemClaimEndpoint,
  stickerStatsEndpoint,
  updateCustomStickerEndpoint,
  type CreateClaimBody,
  type CustomStickerFields,
} from '@/shared/contracts/stickers';

import { myCardsQueryKey } from './use-my-cards';

const studioKey = (clubId: string) => ['custom-stickers', clubId] as const;
const claimsKey = (clubId: string) => ['sticker-claims', clubId] as const;

/** A club's custom stickers, archived ones included, for the studio. */
export function useCustomStickers(clubId: string | null) {
  return useQuery({
    queryKey: studioKey(clubId ?? ''),
    queryFn: ({ signal }) =>
      apiClient.request(
        listCustomStickersEndpoint,
        { params: { clubId: clubId ?? '' }, query: { includeArchived: 'true' } },
        { signal },
      ),
    enabled: clubId !== null,
  });
}

/** Making and changing stickers; cards and award lists refresh because a design shows on them. */
export function useStickerStudioActions(clubId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: studioKey(clubId) }),
      queryClient.invalidateQueries({ queryKey: myCardsQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['member-stickers'] }),
      queryClient.invalidateQueries({ queryKey: ['public-card'] }),
      queryClient.invalidateQueries({ queryKey: ['sticker-album'] }),
      queryClient.invalidateQueries({ queryKey: ['sticker-stats'] }),
    ]);

  const create = useMutation({
    mutationFn: (body: CustomStickerFields) =>
      apiClient.request(createCustomStickerEndpoint, { params: { clubId }, body }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (input: {
      stickerId: string;
      changes: Partial<CustomStickerFields> & { archived?: boolean };
    }) =>
      apiClient.request(updateCustomStickerEndpoint, {
        params: { stickerId: input.stickerId },
        body: input.changes,
      }),
    onSuccess: refresh,
  });
  return { create, update };
}

/** How one sticker is doing (holders, placements, months, givers). */
export function useStickerStats(stickerId: string) {
  return useQuery({
    queryKey: ['sticker-stats', stickerId],
    queryFn: ({ signal }) =>
      apiClient.request(stickerStatsEndpoint, { params: { stickerId } }, { signal }),
    staleTime: 15_000,
  });
}

/** The member's album: every sticker their club has, held or not. */
export function useAlbum(membershipId: string) {
  return useQuery({
    queryKey: ['sticker-album', membershipId],
    queryFn: ({ signal }) =>
      apiClient.request(albumEndpoint, { params: { membershipId } }, { signal }),
  });
}

/** The club's event codes, polled while the panel is open so the count of people who scanned moves. */
export function useClaims(clubId: string) {
  return useQuery({
    queryKey: claimsKey(clubId),
    queryFn: ({ signal }) =>
      apiClient.request(listClaimsEndpoint, { params: { clubId } }, { signal }),
    refetchInterval: 10_000,
  });
}

export function useClaimActions(clubId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: claimsKey(clubId) });
  const create = useMutation({
    mutationFn: (body: CreateClaimBody) =>
      apiClient.request(createClaimEndpoint, { params: { clubId }, body }),
    onSuccess: refresh,
  });
  const close = useMutation({
    mutationFn: (claimId: string) => apiClient.request(closeClaimEndpoint, { params: { claimId } }),
    onSuccess: refresh,
  });
  return { create, close };
}

/** The code on the screen now, asked for again just before it changes. */
export function useClaimCode(claimId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['sticker-claim-code', claimId],
    queryFn: ({ signal }) =>
      apiClient.request(claimCodeEndpoint, { params: { claimId } }, { signal }),
    enabled,
    refetchInterval: (query) => Math.max(2, (query.state.data?.refreshInSeconds ?? 20) - 1) * 1000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

/** Scanning a code. Cards and albums refresh, since a sticker was just added to them. */
export function useRedeemClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiClient.request(redeemClaimEndpoint, { body: { code } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myCardsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['sticker-album'] }),
        queryClient.invalidateQueries({ queryKey: ['public-card'] }),
      ]),
  });
}
