'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import {
  placeMyStickersEndpoint,
  renewCardLinkEndpoint,
  updateMyCardEndpoint,
  type UpdateMyCardBody,
} from '@/shared/contracts/cards';
import type { StickerPlacement } from '@/shared/lib/stickers';

import { myCardsQueryKey } from './use-my-cards';

/**
 * The member's own changes to a card. Each one answers the card as it is now, so the list is
 * updated from the answer and the badge on the page shows the saved state without a second request.
 */
export function useCardActions(membershipId: string) {
  const queryClient = useQueryClient();
  // The QR page shown on the dashboard follows what the member just changed.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: myCardsQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['public-card'] }),
    ]);

  const update = useMutation({
    mutationFn: (body: UpdateMyCardBody) =>
      apiClient.request(updateMyCardEndpoint, { params: { membershipId }, body }),
    onSuccess: refresh,
  });

  const place = useMutation({
    mutationFn: (placements: readonly StickerPlacement[]) =>
      apiClient.request(placeMyStickersEndpoint, {
        params: { membershipId },
        body: { placements: [...placements] },
      }),
    onSuccess: refresh,
  });

  const renew = useMutation({
    mutationFn: () => apiClient.request(renewCardLinkEndpoint, { params: { membershipId } }),
    onSuccess: refresh,
  });

  return { update, place, renew };
}
