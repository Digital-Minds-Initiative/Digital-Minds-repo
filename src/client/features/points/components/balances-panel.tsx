'use client';

import { Crown, History, Plus, SearchX, UsersRound, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';

import { Pager } from './pager';
import { PointsFormDialog } from './points-form-dialog';
import { useAddPoints } from '../hooks/use-points';
import { arrange, type RosterRow, type RosterSort } from '../lib/roster';

const PAGE_SIZE = 12;

export interface BalanceMember {
  id: string;
  fullName: string;
}

interface BalancesPanelProps {
  committee: { id: string; name: string };
  rows: readonly RosterRow[];
  search: string;
  sort: RosterSort;
  canWrite: boolean;
  /** Opens the member's ledger. */
  onOpenMember: (member: BalanceMember) => void;
  onClearSearch: () => void;
}

/** The balance as a badge: the top three places get their own colour, a negative one is red. */
function balanceVariant(row: RosterRow): 'warning' | 'primary' | 'info' | 'danger' | 'outline' {
  if (row.balance < 0) return 'danger';
  if (row.balance > 0 && row.rank === 1) return 'warning';
  if (row.balance > 0 && row.rank === 2) return 'primary';
  if (row.balance > 0 && row.rank === 3) return 'info';
  return 'outline';
}

/**
 * The committee's members with their balance in it. A row opens the member's ledger or records
 * points for them. The list is read whole, so search and sort work on all of it.
 */
export function BalancesPanel({
  committee,
  rows,
  search,
  sort,
  canWrite,
  onOpenMember,
  onClearSearch,
}: BalancesPanelProps) {
  const t = useTranslations('points.screen.balances');
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<BalanceMember | null>(null);

  const arranged = arrange(rows, { search, sort });
  const pageCount = Math.max(1, Math.ceil(arranged.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = arranged.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (rows.length === 0) {
    return <EmptyState icon={UsersRound} title={t('empty.title')} description={t('empty.body')} />;
  }
  if (arranged.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('noMatches.title')}
        description={t('noMatches.body', { search: search.trim() })}
        action={
          <Button variant="outline" onClick={onClearSearch}>
            <X aria-hidden />
            {t('noMatches.clear')}
          </Button>
        }
      />
    );
  }

  return (
    <section aria-label={t('label', { committee: committee.name })} className="grid gap-4">
      <div className="overflow-x-auto rounded-card border border-border bg-surface-1">
        <Table className="min-w-[32rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('member')}</TableHead>
              <TableHead className="w-px text-end">{t('balance')}</TableHead>
              <TableHead className="w-px">
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={row.fullName} />
                    <div className="grid min-w-0 gap-0.5">
                      <button
                        type="button"
                        aria-label={t('open', { name: row.fullName })}
                        onClick={() => onOpenMember(row)}
                        className="w-fit max-w-full cursor-pointer truncate rounded-sm text-start font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
                      >
                        {row.fullName}
                      </button>
                      {row.role === 'LEAD' ? (
                        <Badge variant="info" className="w-fit">
                          <Crown aria-hidden />
                          {t('roles.LEAD')}
                        </Badge>
                      ) : (
                        <span className="text-xs text-fg-muted">{t('roles.MEMBER')}</span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-end">
                  <Badge
                    variant={balanceVariant(row)}
                    className="text-sm"
                    aria-label={
                      row.rank <= 3 && row.balance > 0
                        ? t('rankedBalance', {
                            rank: row.rank,
                            points: format.number(row.balance, 'integer'),
                          })
                        : undefined
                    }
                  >
                    {t('points', { points: format.number(row.balance, 'integer') })}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    {canWrite ? (
                      <Button
                        size="sm"
                        aria-label={t('add', { name: row.fullName })}
                        onClick={() => setAdding(row)}
                      >
                        <Plus aria-hidden />
                        {t('addShort')}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('details', { name: row.fullName })}
                      onClick={() => onOpenMember(row)}
                    >
                      <History aria-hidden />
                      {t('detailsShort')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pager
        page={current}
        pageCount={pageCount}
        onChange={setPage}
        label={t('label', { committee: committee.name })}
      />

      {adding ? (
        <AddForMember member={adding} committee={committee} onClose={() => setAdding(null)} />
      ) : null}
    </section>
  );
}

function AddForMember({
  member,
  committee,
  onClose,
}: {
  member: BalanceMember;
  committee: { id: string; name: string };
  onClose: () => void;
}) {
  const tForm = useTranslations('points.form');
  const add = useAddPoints(member.id);
  return (
    <PointsFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      mode={{
        type: 'add',
        memberName: member.fullName,
        committees: [committee],
        onSubmit: async (committeeId, body) => {
          await add.mutateAsync({ committeeId, body });
          toast.success(tForm('toasts.added'));
        },
      }}
    />
  );
}
