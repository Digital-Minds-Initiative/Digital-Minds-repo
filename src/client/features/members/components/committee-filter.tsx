'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The radio value that stands for "no committee filter" (an empty value is not allowed). */
const ALL = 'all';

interface CommitteeFilterProps {
  committees: ReadonlyArray<{ id: string; name: string }>;
  /** The chosen committee, or undefined for every committee. */
  selected: string | undefined;
  onChange: (selected: string | undefined) => void;
}

/**
 * Pick one committee: the list then shows that committee's members, and the points column shows
 * that committee's points (the API's `committeeId` filter). "All committees" clears the choice.
 */
export function CommitteeFilter({ committees, selected, onChange }: CommitteeFilterProps) {
  const t = useTranslations('members.filters');
  const chosen = committees.find((committee) => committee.id === selected);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('committee')}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface-1 px-3 py-1 text-sm text-fg shadow-sm sm:w-44',
            'transition-colors outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring/30 focus-visible:outline-solid',
            chosen && 'border-primary',
          )}
        >
          <span className="truncate">{chosen?.name ?? t('allCommittees')}</span>
          <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{t('committeeHint')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={selected ?? ALL}
          onValueChange={(value) => onChange(value === ALL ? undefined : value)}
        >
          <DropdownMenuRadioItem value={ALL}>{t('allCommittees')}</DropdownMenuRadioItem>
          {committees.map((committee) => (
            <DropdownMenuRadioItem key={committee.id} value={committee.id}>
              {committee.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
