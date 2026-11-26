'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import {
  createCustomStickerEndpoint,
  listCustomStickersEndpoint,
  updateCustomStickerEndpoint,
  type CustomStickerFields,
} from '@/shared/contracts/stickers';

import { myCardsQueryKey } from './use-my-cards';

const studioKey = (clubId: string) => ['custom-stickers', clubId] as const;

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
