'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface CommitteeFilterProps {
  committees: ReadonlyArray<{ id: string; name: string }>;
  /** The chosen committee ids; empty means every committee. */
  selected: readonly string[];
  onChange: (selected: string[] | undefined) => void;
}

/**
 * Pick one committee or several: the list shows the members of ANY of the chosen committees
 * (the API's `committeeId` filter). Each committee has its own box and the menu stays open while
 * choosing; "all committees" clears the choice.
 */
export function CommitteeFilter({ committees, selected, onChange }: CommitteeFilterProps) {
  const t = useTranslations('members.filters');
  const chosen = new Set(selected);
  const names = committees.filter((committee) => chosen.has(committee.id));

  const summary =
    names.length === 0
      ? t('allCommittees')
      : names.length === 1
        ? (names[0]?.name ?? '')
        : t('committeesSelected', { count: names.length });

  function toggle(id: string, checked: boolean) {
    const next = new Set(chosen);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(next.size > 0 ? [...next] : undefined);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('committee')}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface-1 px-3 py-1 text-sm text-fg shadow-sm sm:w-44',
            'transition-colors outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring/30 focus-visible:outline-solid',
            names.length > 0 && 'border-primary',
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{t('committeeHint')}</DropdownMenuLabel>
        <DropdownMenuItem disabled={names.length === 0} onSelect={() => onChange(undefined)}>
          {t('allCommittees')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {committees.map((committee) => (
          <DropdownMenuCheckboxItem
            key={committee.id}
            checked={chosen.has(committee.id)}
            onCheckedChange={(checked) => toggle(committee.id, checked === true)}
            // Keep the menu open so several committees can be ticked in one go.
            onSelect={(event) => event.preventDefault()}
          >
            {committee.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
