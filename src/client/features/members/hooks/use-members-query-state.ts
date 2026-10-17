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
      // Changing the period resets the order to the one that period implies (points, highest
      // first, when there is one) unless the same change picks an order itself.
      if (('from' in patch || 'to' in patch) && !('sort' in patch)) {
        const implied = impliedOrder(next);
        next.sort = implied.sort;
        next.order = implied.order;
      }
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

/** The order the API falls back to for this query: points descending with a period, else name. */
export function impliedOrder(
  query: Pick<ListMembersQuery, 'from' | 'to'>,
): Pick<ListMembersQuery, 'sort' | 'order'> {
  const { sort, order } = listMembersQuerySchema.parse({ from: query.from, to: query.to });
  return { sort, order };
}

/** Leaves out every value the API would fill in by itself, so the URL stays short. */
function withoutDefaults(query: ListMembersQuery): Partial<ListMembersQuery> {
  const fallbacks: ListMembersQuery = { ...DEFAULTS, ...impliedOrder(query) };
  return Object.fromEntries(
    Object.entries(query).filter(([key, value]) => {
      const fallback = fallbacks[key as keyof ListMembersQuery];
      return value !== undefined && JSON.stringify(value) !== JSON.stringify(fallback);
    }),
  );
}
