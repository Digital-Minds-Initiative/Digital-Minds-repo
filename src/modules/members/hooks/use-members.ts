'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { listMembersEndpoint, type ListMembersQuery } from '../contracts';

/** Query keys for this module. Every server-side parameter is part of the key. */
const membersKeys = {
  all: ['members'] as const,
  list: (query: ListMembersQuery) => [...membersKeys.all, 'list', query] as const,
};

/** One page of members for the current query; keeps the previous page visible while loading. */
export function useMembers(query: ListMembersQuery) {
  return useQuery({
    queryKey: membersKeys.list(query),
    queryFn: ({ signal }) => apiClient.request(listMembersEndpoint, { query }, { signal }),
    placeholderData: keepPreviousData,
  });
}
