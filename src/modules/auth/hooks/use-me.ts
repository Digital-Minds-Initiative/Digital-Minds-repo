'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { meEndpoint } from '../contracts';

const meQueryKey = ['me'] as const;

/** The signed-in user and their access. Errors with ApiError(401) when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => apiClient.request(meEndpoint, {}, { signal }),
    staleTime: 60_000,
  });
}
