'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import { meEndpoint } from '@/shared/contracts/auth';

const meQueryKey = ['me'] as const;

/** The signed-in user and their access. Errors with ApiError(401) when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => apiClient.request(meEndpoint, {}, { signal }),
    staleTime: 60_000,
  });
}
