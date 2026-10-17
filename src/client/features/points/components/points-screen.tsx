'use client';

import { Coins, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { useErrorText } from '@/client/lib/use-error-text';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { BalancesPanel, type BalanceMember } from './balances-panel';
import { FilterBar } from './filter-bar';
import { KpiCards } from './kpi-cards';
import { MemberPointsSheet, type PointsMember } from './member-points-sheet';
import { useCommitteeMembers } from '../hooks/use-points';
import { canWritePoints, seesWholeClub } from '../lib/access';
import { buildRoster, type RosterSort } from '../lib/roster';

interface PointsScreenProps {
  title: string;
  description: string;
}

/**
 * The points page. The person picks one of the committees inside their own scope — a club officer
 * and a full admin see every committee of their clubs, a committee lead only the ones they lead —
 * and sees its members with their points in it. Opening a member shows their ledger, where points
 * are recorded, corrected and cancelled. Everything comes from the members list and the member's
 * points endpoints; the server limits it all to the same scope.
 */
export function PointsScreen({ title, description }: PointsScreenProps) {
  const t = useTranslations('points.screen');
  const tFilters = useTranslations('points.screen.filters');
  const errorText = useErrorText();
  const me = useMe();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<RosterSort>('points');
  const [open, setOpen] = useState<PointsMember | null>(null);

  const committees = me.data?.access.committees ?? [];
  const selected = committees.find((committee) => committee.id === selectedId) ?? committees[0];
  const members = useCommitteeMembers(selected?.id ?? '', selected?.clubId ?? '');
  const rows = useMemo(
    () => (members.data && selected ? buildRoster(members.data, selected.id) : null),
    [members.data, selected],
  );

  if (me.isPending) {
    return (
      <div className="grid gap-6">
        <PageHeader title={title} description={description} />
        <Skeleton className="h-64 w-full" aria-busy />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="grid gap-6">
        <PageHeader title={title} description={description} />
        <EmptyState
          title={t('loadFailed')}
          description={errorText(me.error)}
          action={
            <Button variant="outline" onClick={() => void me.refetch()}>
              <RotateCw aria-hidden />
              {t('retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (!selected) {
    return (
      <div className="grid gap-6">
        <PageHeader title={title} description={description} />
        <EmptyState
          icon={Coins}
          title={t('noCommittees.title')}
          description={t('noCommittees.body')}
        />
      </div>
    );
  }

  const access = me.data.access;
  const clubName = (clubId: string) => access.clubs.find((club) => club.id === clubId)?.name ?? '';
  const severalClubs = new Set(committees.map((committee) => committee.clubId)).size > 1;
  const label = (committee: (typeof committees)[number]) =>
    severalClubs
      ? t('committeeWithClub', { club: clubName(committee.clubId), committee: committee.name })
      : committee.name;
  const canWrite = canWritePoints(me.data, selected.clubId, selected.id);
  const leadOnly = !seesWholeClub(me.data, selected.clubId);

  function openMember(member: BalanceMember) {
    if (!selected) return;
    setOpen({
      id: member.id,
      fullName: member.fullName,
      clubId: selected.clubId,
      clubName: clubName(selected.clubId),
      committees: [{ id: selected.id, name: selected.name }],
      removed: false,
    });
  }

  return (
    <div className="grid gap-5">
      <PageHeader title={title} description={description} />

      <KpiCards rows={rows} />

      <FilterBar
        search={search}
        onSearch={setSearch}
        committees={committees.map((committee) => ({ id: committee.id, label: label(committee) }))}
        committeeId={selected.id}
        onCommittee={(id) => {
          setSelectedId(id);
          setSearch('');
        }}
        sort={sort}
        sortOptions={(['points', 'lowest', 'name'] as const).map((value) => ({
          value,
          label: tFilters(`sorts.${value}`),
        }))}
        onSort={(value) => setSort(value as RosterSort)}
      />

      {leadOnly ? (
        <p role="note" className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg-muted">
          {t('leadNote')}
        </p>
      ) : null}

      {/* Keyed by committee so the page of one never carries over to the next. */}
      {rows ? (
        <BalancesPanel
          key={selected.id}
          committee={selected}
          rows={rows}
          search={search}
          sort={sort}
          canWrite={canWrite}
          onOpenMember={openMember}
          onClearSearch={() => setSearch('')}
        />
      ) : members.isError ? (
        <EmptyState
          title={errorText(members.error)}
          action={
            <Button variant="outline" onClick={() => void members.refetch()}>
              <RotateCw aria-hidden />
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <Skeleton className="h-64 w-full" aria-busy />
      )}

      <MemberPointsSheet member={open} onClose={() => setOpen(null)} />
    </div>
  );
}
