'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import { myCardsEndpoint } from '@/shared/contracts/wallet';

export const myCardsQueryKey = ['me', 'cards'] as const;

/** The signed-in person's own member cards, one per club they belong to. */
export function useMyCards() {
  return useQuery({
    queryKey: myCardsQueryKey,
    queryFn: ({ signal }) => apiClient.request(myCardsEndpoint, {}, { signal }),
    staleTime: 60_000,
  });
}
