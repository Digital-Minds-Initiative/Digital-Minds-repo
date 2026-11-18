'use client';

import { RotateCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useAuthorName } from '@/client/lib/use-author-name';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useMemberTypeHistory } from '../hooks/use-member-actions';

/**
 * Every change of the member's type, newest first: from what to what, when and by whom — an edit,
 * a return to the club with another type, or a type deleted with its members moved
 * (docs/adr/0031-membership-type-history.md). Anyone who can open the member can read it.
 */
export function MemberTypeHistory({ memberId }: { memberId: string }) {
  const t = useTranslations('members.sheet.typeHistory');
  const format = useFormatter();
  const authorName = useAuthorName();
  const [page, setPage] = useState(1);
  const history = useMemberTypeHistory(memberId, page);

  if (history.isPending) return <Skeleton className="h-16 w-full" aria-busy />;
  if (history.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 p-4 text-sm">
        <span className="text-fg-muted">{t('loadFailed')}</span>
        <Button variant="outline" size="sm" onClick={() => void history.refetch()}>
          <RotateCw aria-hidden />
          {t('retry')}
        </Button>
      </div>
    );
  }

  const changes = history.data.items.filter((change) => change.kind === 'MEMBER_TYPE_CHANGED');
  if (changes.length === 0 && page === 1) {
    return (
      <p className="m-0 rounded-card border border-border bg-surface-1 p-4 text-sm text-fg-muted">
        {t('empty')}
      </p>
    );
  }
  const { pageCount } = history.data;
  return (
    <div className="grid gap-2">
      <ol className="m-0 grid list-none gap-0 rounded-card border border-border bg-surface-1 p-0 text-sm">
        {changes.map((change) => (
          <li
            key={change.id}
            className="grid gap-1 border-b border-border px-4 py-3 last:border-b-0"
          >
            <span className="font-medium">
              {t('arrow', { from: change.previousType, to: change.newType })}
            </span>
            {change.source === 'EDIT' ? null : (
              <span className="text-xs text-fg-muted">{t(`sources.${change.source}`)}</span>
            )}
            <span className="text-xs text-fg-muted">
              {t('by', {
                name: authorName(change.changedBy.fullName),
                date: format.dateTime(new Date(change.createdAt), 'dateTime'),
              })}
            </span>
          </li>
        ))}
      </ol>
      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            {t('newer')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            {t('older')}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
