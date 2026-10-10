'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { searchParamsToObject, toSearchParams } from '@/shared/contracts/core';
import { listMembersQuerySchema, type ListMembersQuery } from '@/shared/contracts/members';

const DEFAULTS: ListMembersQuery = listMembersQuerySchema.parse({});

/**
 * The members list query lives in the URL (`?q=…&clubId=…&page=2`), parsed with the SAME Zod
 * schema the API uses. Pages are shareable and the back button works. Copy this pattern for
 * other server-side tables.
 */
export function useMembersQueryState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const query = useMemo<ListMembersQuery>(() => {
    const parsed = listMembersQuerySchema.safeParse(searchParamsToObject(searchParams));
    return parsed.success ? parsed.data : DEFAULTS;
  }, [searchParams]);

  const setQuery = useCallback(
    (patch: Partial<ListMembersQuery>) => {
      // Any change other than the page itself starts again from page 1.
      const next: ListMembersQuery = {
        ...query,
        ...patch,
        ...('page' in patch ? {} : { page: 1 }),
      };
      const params: Record<string, string | string[]> = {};
      for (const [key, value] of toSearchParams(withoutDefaults(next))) {
        const existing = params[key];
        params[key] = existing === undefined ? value : [...[existing].flat(), value];
      }
      router.replace({ pathname, query: params }, { scroll: false });
    },
    [query, router, pathname],
  );

  return { query, setQuery, defaults: DEFAULTS };
}

function withoutDefaults(query: ListMembersQuery): Partial<ListMembersQuery> {
  return Object.fromEntries(
    Object.entries(query).filter(([key, value]) => {
      const fallback = DEFAULTS[key as keyof ListMembersQuery];
      return value !== undefined && JSON.stringify(value) !== JSON.stringify(fallback);
    }),
  );
}
