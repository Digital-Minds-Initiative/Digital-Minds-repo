'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import { sessionStateEndpoint } from '@/shared/contracts/auth';

export const sessionQueryKey = ['auth', 'session'] as const;

/** Where this browser is in the sign-in flow. Never 401. */
export function useSessionState() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => apiClient.request(sessionStateEndpoint, {}, { signal }),
    staleTime: 0,
  });
}
