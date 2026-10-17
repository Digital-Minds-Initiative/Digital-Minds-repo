'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilterBarProps {
  search: string;
  onSearch: (value: string) => void;
  committees: ReadonlyArray<{ id: string; label: string }>;
  committeeId: string;
  onCommittee: (id: string) => void;
  sort: string;
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
  onSort: (value: string) => void;
}

/**
 * One row for everything that narrows the page: a search box for the member's name, the committee
 * and the sort. It wraps instead of squeezing on narrow screens.
 */
export function FilterBar({
  search,
  onSearch,
  committees,
  committeeId,
  onCommittee,
  sort,
  sortOptions,
  onSort,
}: FilterBarProps) {
  const t = useTranslations('points.screen.filters');

  return (
    <div
      role="search"
      className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-1 p-3"
    >
      <div className="relative min-w-56 flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('searchMember')}
          aria-label={t('searchMember')}
          autoComplete="off"
          className="ps-9"
        />
      </div>

      <Select value={committeeId} onValueChange={onCommittee}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t('committee')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {committees.map((committee) => (
            <SelectItem key={committee.id} value={committee.id}>
              {committee.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={onSort}>
        <SelectTrigger className="w-full sm:w-44" aria-label={t('sort')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
