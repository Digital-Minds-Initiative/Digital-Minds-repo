'use client';

import { History, RotateCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useAuthorName } from '@/client/lib/use-author-name';
import { useErrorText } from '@/client/lib/use-error-text';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useRoleHistory } from '../hooks/use-permissions';

/**
 * Every appointment and removal in the club, newest first: who changed whose role, from what to
 * what, and when. It records explicit changes only; the note under the table says so.
 */
export function HistoryPanel({ clubId }: { clubId: string }) {
  const t = useTranslations('permissions.history');
  const format = useFormatter();
  const errorText = useErrorText();
  const authorName = useAuthorName();
  const [page, setPage] = useState(1);
  const history = useRoleHistory(clubId, page);

  if (history.isPending) return <Skeleton className="h-48 w-full" aria-busy />;
  if (history.isError) {
    return (
      <EmptyState
        title={errorText(history.error)}
        action={
          <Button variant="outline" onClick={() => void history.refetch()}>
            <RotateCw aria-hidden />
            {t('retry')}
          </Button>
        }
      />
    );
  }

  const { items, pageCount } = history.data;
  if (items.length === 0) {
    return <EmptyState icon={History} title={t('empty.title')} description={t('empty.body')} />;
  }
  return (
    <section aria-label={t('label')} className="grid gap-4">
      <div className="overflow-x-auto rounded-card border border-border bg-surface-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('date')}</TableHead>
              <TableHead>{t('member')}</TableHead>
              <TableHead>{t('change')}</TableHead>
              <TableHead>{t('changedBy')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((change) => (
              <TableRow key={change.id}>
                <TableCell className="whitespace-nowrap text-fg-muted">
                  {format.dateTime(new Date(change.createdAt), 'dateTime')}
                </TableCell>
                <TableCell className="font-medium">{change.member.fullName}</TableCell>
                <TableCell>
                  <span className="grid gap-0.5">
                    <span>
                      {t('arrow', {
                        from: t(`roles.${change.previousRole}`),
                        to: t(`roles.${change.newRole}`),
                      })}
                    </span>
                    {change.committee ? (
                      <span className="text-xs text-fg-muted">
                        {t('inCommittee', { committee: change.committee.name })}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>{authorName(change.changedBy.fullName)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 ? (
        <nav aria-label={t('label')} className="flex items-center justify-between gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-fg-muted">{t('pagination.page', { page, pages: pageCount })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            {t('pagination.next')}
          </Button>
        </nav>
      ) : null}
      <p className="text-xs text-fg-muted">{t('note')}</p>
    </section>
  );
}
