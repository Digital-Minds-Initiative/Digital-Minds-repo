'use client';

import { ChevronDown, ChevronUp, Pencil, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useAuthorName } from '@/client/lib/use-author-name';
import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PointTransaction } from '@/shared/contracts/points';

import { useRevisions } from '../hooks/use-points';

interface TransactionRowProps {
  transaction: PointTransaction;
  /** May the person edit and cancel it (lead of the committee, club officer, full admin). */
  canWrite: boolean;
  /** Who the points are for, when the list spans members (the member's own ledger omits it). */
  memberLabel?: string;
  onEdit: (transaction: PointTransaction) => void;
  onCancel: (transaction: PointTransaction) => void;
}

/**
 * One ledger entry: the amount (green adds, red deducts), the reason and the work date, who
 * recorded it and when. A cancelled entry stays in the list, struck through and marked, with who
 * cancelled it and why; an entry that was changed offers the list of what it used to say.
 */
export function TransactionRow({
  transaction,
  canWrite,
  memberLabel,
  onEdit,
  onCancel,
}: TransactionRowProps) {
  const t = useTranslations('points.transaction');
  const format = useFormatter();
  const authorName = useAuthorName();
  const [showHistory, setShowHistory] = useState(false);
  const cancelled = transaction.status === 'CANCELLED';
  const day = (isoDate: string) => format.dateTime(new Date(`${isoDate}T12:00:00Z`), 'dateShort');
  const moment = (iso: string) => format.dateTime(new Date(iso), 'dateTime');

  return (
    <li
      data-status={transaction.status}
      className={cn(
        'grid gap-2 rounded-lg border border-border bg-surface-1 p-3',
        cancelled && 'border-dashed bg-surface-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <p className={cn('text-sm font-medium', cancelled && 'text-fg-muted line-through')}>
            {transaction.reason}
          </p>
          {memberLabel ? (
            <p className="text-xs font-semibold text-fg-muted">{memberLabel}</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span className="font-mono [direction:ltr]">{day(transaction.workDate)}</span>
            <Badge variant="outline">{transaction.committee.name}</Badge>
            {cancelled ? <Badge variant="neutral">{t('cancelledBadge')}</Badge> : null}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 font-mono text-lg font-bold [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]',
            cancelled
              ? 'text-fg-muted line-through'
              : transaction.amount < 0
                ? 'text-danger'
                : 'text-success',
          )}
          aria-label={t('points', { amount: format.number(transaction.amount, 'points') })}
        >
          {format.number(transaction.amount, 'points')}
        </span>
      </div>

      <p className="text-xs text-fg-subtle">
        {t('recorded', {
          name: authorName(transaction.createdBy.fullName),
          date: moment(transaction.createdAt),
        })}
      </p>
      {cancelled && transaction.cancelledBy && transaction.cancelledAt ? (
        <p className="text-xs text-fg-muted">
          {t('cancelled', {
            name: authorName(transaction.cancelledBy.fullName),
            date: moment(transaction.cancelledAt),
          })}
          {transaction.cancellationReason
            ? ` · ${t('cancelReason', { reason: transaction.cancellationReason })}`
            : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {transaction.revisionCount > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            {t('edited', { count: transaction.revisionCount })}
          </Button>
        ) : null}
        {canWrite && !cancelled ? (
          <span className="ms-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('actions.editLabel', { reason: transaction.reason })}
              onClick={() => onEdit(transaction)}
            >
              <Pencil aria-hidden />
              {t('actions.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('actions.cancelLabel', { reason: transaction.reason })}
              onClick={() => onCancel(transaction)}
            >
              <Undo2 aria-hidden />
              {t('actions.cancel')}
            </Button>
          </span>
        ) : null}
      </div>

      {showHistory ? <Revisions transactionId={transaction.id} /> : null}
    </li>
  );
}

function Revisions({ transactionId }: { transactionId: string }) {
  const t = useTranslations('points.transaction.revisions');
  const authorName = useAuthorName();
  const format = useFormatter();
  const revisions = useRevisions(transactionId, true);

  if (revisions.isPending) return <p className="text-xs text-fg-muted">{t('loading')}</p>;
  if (revisions.isError) return <p className="text-xs text-danger">{t('failed')}</p>;
  return (
    <ol
      aria-label={t('title')}
      className="m-0 grid list-none gap-2 border-s-2 border-border-strong ps-3 text-xs"
    >
      {revisions.data.items.map((revision) => (
        <li key={revision.id} className="grid gap-0.5">
          <span className="font-semibold">{t(revision.action)}</span>
          <span className="text-fg-muted">
            {t('before', {
              amount: format.number(revision.previous.amount, 'points'),
              reason: revision.previous.reason,
              date: format.dateTime(
                new Date(`${revision.previous.workDate}T12:00:00Z`),
                'dateShort',
              ),
            })}
          </span>
          <span className="text-fg-subtle">
            {t('by', {
              name: authorName(revision.changedBy.fullName),
              date: format.dateTime(new Date(revision.changedAt), 'dateTime'),
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}
