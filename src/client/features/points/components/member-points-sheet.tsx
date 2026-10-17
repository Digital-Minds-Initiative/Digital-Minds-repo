'use client';

import { Plus, RotateCw, ScrollText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

import { PointsFormDialog } from './points-form-dialog';
import { TransactionList } from './transaction-list';
import { useAddPoints, useMemberPoints } from '../hooks/use-points';
import { canWritePoints, seesWholeClub } from '../lib/access';

const ALL = 'all';
const PAGE_SIZE = 10;

/** What the ledger needs to know about the member it opens; the points page builds it from its rows. */
export interface PointsMember {
  /** Membership id. */
  id: string;
  fullName: string;
  clubId: string;
  clubName: string;
  /** Committees to offer when recording points for the member. */
  committees: ReadonlyArray<{ id: string; name: string }>;
  /** Removed members keep a readable history but get no new points. */
  removed: boolean;
}

export interface MemberPointsSheetProps {
  /** The member whose ledger is open, or null when the sheet is closed. */
  member: PointsMember | null;
  onClose: () => void;
}

export function MemberPointsSheet({ member, onClose }: MemberPointsSheetProps) {
  const t = useTranslations('points.sheet');
  return (
    <Sheet
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={undefined}>
        {member ? (
          // Keyed by member so one member's page, filters and open dialogs never carry over.
          <MemberLedger key={member.id} member={member} />
        ) : (
          <SheetHeader>
            <SheetTitle>{t('history')}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemberLedger({ member }: { member: PointsMember }) {
  const t = useTranslations('points.sheet');
  const tForm = useTranslations('points.form');
  const format = useFormatter();
  const errorText = useErrorText();
  const toggleId = useId();
  const me = useMe();
  const [page, setPage] = useState(1);
  const [committeeId, setCommitteeId] = useState<string | undefined>();
  const [showCancelled, setShowCancelled] = useState(false);
  const [adding, setAdding] = useState(false);

  const points = useMemberPoints(member.id, {
    page,
    pageSize: PAGE_SIZE,
    status: showCancelled ? 'all' : 'active',
    ...(committeeId ? { committeeId } : {}),
  });
  const add = useAddPoints(member.id);

  const access = me.data;
  const writableCommittees = access
    ? member.committees.filter((committee) => canWritePoints(access, member.clubId, committee.id))
    : [];
  const limitedToLedCommittees = access ? !seesWholeClub(access, member.clubId) : false;
  const canAdd = !member.removed && writableCommittees.length > 0;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{t('title', { name: member.fullName })}</SheetTitle>
        <SheetDescription>{t('description')}</SheetDescription>
        <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge variant="outline">{member.clubName}</Badge>
        </p>
      </SheetHeader>

      {member.removed ? (
        <p role="note" className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg-muted">
          {t('removedNotice')}
        </p>
      ) : null}
      {limitedToLedCommittees ? (
        <p role="note" className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg-muted">
          {t('scopeNote')}
        </p>
      ) : null}

      {points.isPending ? (
        <div aria-busy className="grid gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : points.isError ? (
        <EmptyState
          title={t('loadFailed')}
          description={errorText(points.error)}
          action={
            <Button variant="outline" onClick={() => void points.refetch()}>
              <RotateCw aria-hidden />
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <>
          <section
            aria-label={t('balance')}
            className="grid gap-3 rounded-card border border-border bg-surface-1 p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-fg-muted">{t('balance')}</span>
              <span
                data-testid="member-balance"
                className={cn(
                  'font-mono text-3xl font-bold [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]',
                  points.data.totals.balance < 0 && 'text-danger',
                )}
              >
                {format.number(points.data.totals.balance, 'integer')}
              </span>
            </div>
            {points.data.byCommittee.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('noBalances')}</p>
            ) : (
              <ul aria-label={t('byCommittee')} className="m-0 flex list-none flex-wrap gap-2 p-0">
                {points.data.byCommittee.map((entry) => (
                  <li key={entry.committee.id}>
                    <Badge variant="neutral" className="gap-2">
                      {entry.committee.name}
                      <span className="font-mono [direction:ltr]">
                        {format.number(entry.balance, 'integer')}
                      </span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            {member.committees.length > 1 ? (
              <Select
                value={committeeId ?? ALL}
                onValueChange={(value) => {
                  setCommitteeId(value === ALL ? undefined : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-44" aria-label={t('filters.committee')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.allCommittees')}</SelectItem>
                  {member.committees.map((committee) => (
                    <SelectItem key={committee.id} value={committee.id}>
                      {committee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="flex items-center gap-2">
              <Checkbox
                id={toggleId}
                checked={showCancelled}
                onCheckedChange={(checked) => {
                  setShowCancelled(checked === true);
                  setPage(1);
                }}
              />
              <Label htmlFor={toggleId}>{t('filters.showCancelled')}</Label>
            </div>
            {canAdd ? (
              <Button size="sm" className="ms-auto" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t('add')}
              </Button>
            ) : null}
          </div>

          {points.data.transactions.items.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('empty.title')} description={t('empty.body')} />
          ) : (
            <TransactionList
              label={t('history')}
              transactions={points.data.transactions.items}
              canWrite={(transaction) =>
                access ? canWritePoints(access, member.clubId, transaction.committee.id) : false
              }
            />
          )}

          {points.data.transactions.pageCount > 1 ? (
            <nav
              className="flex items-center justify-between gap-3 text-sm"
              aria-label={t('history')}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('pagination.previous')}
              </Button>
              <span className="text-fg-muted">
                {t('pagination.page', {
                  page,
                  pages: points.data.transactions.pageCount,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= points.data.transactions.pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('pagination.next')}
              </Button>
            </nav>
          ) : null}
        </>
      )}

      <PointsFormDialog
        open={adding}
        onOpenChange={setAdding}
        mode={{
          type: 'add',
          memberName: member.fullName,
          committees: writableCommittees,
          onSubmit: async (targetCommitteeId, body) => {
            await add.mutateAsync({ committeeId: targetCommitteeId, body });
            toast.success(tForm('toasts.added'));
          },
        }}
      />
    </>
  );
}
