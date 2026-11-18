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
import type { Club, MembershipTypeChange } from '@/shared/contracts/clubs';

import { useClubTypeHistory } from '../hooks/use-clubs';
import type { ClubAccess } from '../lib/access';

interface MembershipTypeHistoryPanelProps {
  club: Club;
  access: ClubAccess;
}

/**
 * Who added, renamed and deleted the club's membership types, and who changed whose type from what
 * to what, newest first (docs/adr/0031-membership-type-history.md). The server sends only what the
 * person's scope holds: a committee lead sees their committees' members' type changes and nothing
 * about the types themselves, so the empty state and the note say which of the two this is.
 */
export function MembershipTypeHistoryPanel({ club, access }: MembershipTypeHistoryPanelProps) {
  const t = useTranslations('clubs.typeHistory');
  const format = useFormatter();
  const errorText = useErrorText();
  const authorName = useAuthorName();
  const [page, setPage] = useState(1);
  const history = useClubTypeHistory(club.id, page);
  const isLead = access.role === 'lead';

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
    return (
      <EmptyState
        icon={History}
        title={t('empty.title')}
        description={t(isLead ? 'empty.lead' : 'empty.body')}
      />
    );
  }
  return (
    <section aria-label={t('label')} className="grid gap-4">
      <div className="overflow-x-auto rounded-card border border-border bg-surface-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('date')}</TableHead>
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
                <TableCell>
                  <ChangeDescription change={change} />
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
      <p className="text-xs text-fg-muted">{t(isLead ? 'noteLead' : 'note')}</p>
    </section>
  );
}

/**
 * One row's change: the change itself (`from ← to`, or the type's name), and what happened on a
 * muted line under it. A member's row starts with whose type it was.
 */
function ChangeDescription({ change }: { change: MembershipTypeChange }) {
  const t = useTranslations('clubs.typeHistory');
  const [main, context] = ((): [string, string | null] => {
    switch (change.kind) {
      case 'TYPE_CREATED':
        return [change.name, t('kinds.TYPE_CREATED')];
      case 'TYPE_RENAMED':
        return [
          t('arrow', { from: change.previousName, to: change.newName }),
          t('kinds.TYPE_RENAMED'),
        ];
      case 'TYPE_DELETED':
        return [
          change.name,
          change.movedTo === null
            ? t('kinds.TYPE_DELETED')
            : t('kinds.TYPE_DELETED_MOVED', { count: change.movedMembers, to: change.movedTo }),
        ];
      case 'MEMBER_TYPE_CHANGED':
        return [
          t('arrow', { from: change.previousType, to: change.newType }),
          change.source === 'EDIT' ? null : t(`sources.${change.source}`),
        ];
    }
  })();
  return (
    <span className="grid gap-0.5">
      {change.kind === 'MEMBER_TYPE_CHANGED' ? (
        <span className="font-medium">{change.member.fullName}</span>
      ) : null}
      <span>{main}</span>
      {context ? <span className="text-xs text-fg-muted">{context}</span> : null}
    </span>
  );
}
