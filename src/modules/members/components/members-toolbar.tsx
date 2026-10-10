'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Me } from '@/modules/auth/contracts';

import { memberStatusSchema, type ListMembersQuery } from '../contracts';

const ALL = 'all';
const SEARCH_DEBOUNCE_MS = 300;

interface MembersToolbarProps {
  query: ListMembersQuery;
  onChange: (patch: Partial<ListMembersQuery>) => void;
  access: Me['access'] | undefined;
}

export function MembersToolbar({ query, onChange, access }: MembersToolbarProps) {
  const t = useTranslations('members.filters');
  const tCommon = useTranslations('common.actions');
  const [search, setSearch] = useState(query.q ?? '');

  // Push the search to the URL once typing pauses.
  useEffect(() => {
    const next = search.trim() || undefined;
    if (next === query.q) return;
    const timer = setTimeout(() => onChange({ q: next }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query.q, onChange]);

  const clubs = access?.clubs ?? [];
  const committees = (access?.committees ?? []).filter(
    (committee) => !query.clubId || committee.clubId === query.clubId,
  );
  const selectedCommittee = query.committeeId?.[0];
  const hasFilters = Boolean(
    query.q || query.clubId || selectedCommittee || query.status !== 'active',
  );

  return (
    <>
      <div className="relative w-full sm:w-72">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="ps-9"
        />
      </div>

      {clubs.length > 1 ? (
        <Select
          value={query.clubId ?? ALL}
          onValueChange={(value) =>
            onChange({ clubId: value === ALL ? undefined : value, committeeId: undefined })
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t('club')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allClubs')}</SelectItem>
            {clubs.map((club) => (
              <SelectItem key={club.id} value={club.id}>
                {club.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {committees.length > 0 ? (
        <Select
          value={selectedCommittee ?? ALL}
          onValueChange={(value) => onChange({ committeeId: value === ALL ? undefined : [value] })}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t('committee')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allCommittees')}</SelectItem>
            {committees.map((committee) => (
              <SelectItem key={committee.id} value={committee.id}>
                {committee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select
        value={query.status}
        onValueChange={(value) => onChange({ status: memberStatusSchema.parse(value) })}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t('status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t('statusActive')}</SelectItem>
          <SelectItem value="removed">{t('statusRemoved')}</SelectItem>
          <SelectItem value="all">{t('statusAll')}</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            onChange({ q: undefined, clubId: undefined, committeeId: undefined, status: 'active' });
          }}
        >
          <X aria-hidden />
          {tCommon('clearFilters')}
        </Button>
      ) : null}
    </>
  );
}
