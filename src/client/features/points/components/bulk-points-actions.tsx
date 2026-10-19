'use client';

import { UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { Button } from '@/components/ui/button';

import { BulkPointsDialog, type BulkGroup } from './bulk-points-dialog';
import { useClubBulkPoints, useClubMembers, useCommitteeBulkPoints } from '../hooks/use-points';

interface BulkPointsActionsProps {
  committee: { id: string; name: string; clubId: string };
  clubName: string;
  /** The club's committees the person sees (all of them for an officer). */
  clubCommittees: ReadonlyArray<{ id: string; name: string }>;
  /** The selected committee's members, from the page's roster. */
  members: ReadonlyArray<{ id: string; fullName: string }> | null;
  /** May record points in the selected committee (its lead, the club's officers, full admins). */
  canWrite: boolean;
  /** May record points across the club: officers and full admins, not a lead. */
  canWriteClub: boolean;
}

/**
 * The two ways to give many members points at once, beside the page title: the selected
 * committee's members, or — for those who manage the club — pairs across its committees.
 */
export function BulkPointsActions({
  committee,
  clubName,
  clubCommittees,
  members,
  canWrite,
  canWriteClub,
}: BulkPointsActionsProps) {
  const t = useTranslations('points.bulk');
  const tCommon = useTranslations('common.actions');
  const errorText = useErrorText();
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  const committeeBulk = useCommitteeBulkPoints(committee.id);
  const clubBulk = useClubBulkPoints(committee.clubId);
  const roster = useClubMembers(committee.clubId, clubOpen);

  const committeeGroups = useMemo<BulkGroup[]>(
    () => [{ committee, members: members ?? [] }],
    [committee, members],
  );
  const clubGroups = useMemo<BulkGroup[]>(
    () =>
      clubCommittees.map((each) => ({
        committee: each,
        members: (roster.data ?? [])
          .filter((member) => member.committees.some((c) => c.id === each.id))
          .map((member) => ({ id: member.id, fullName: member.user.fullName })),
      })),
    [clubCommittees, roster.data],
  );

  if (!canWrite && !canWriteClub) return null;
  return (
    <>
      {clubOpen && roster.isError ? (
        <span role="alert" className="flex items-center gap-2 text-sm text-danger">
          {t('loadFailed')}: {errorText(roster.error)}
          <Button size="sm" variant="outline" onClick={() => void roster.refetch()}>
            {t('retry')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClubOpen(false)}>
            {tCommon('close')}
          </Button>
        </span>
      ) : null}
      {canWrite ? (
        <Button onClick={() => setCommitteeOpen(true)} disabled={members === null}>
          <UsersRound aria-hidden />
          {t('open')}
        </Button>
      ) : null}
      {canWriteClub ? (
        <Button
          variant="outline"
          onClick={() => setClubOpen(true)}
          loading={clubOpen && roster.isPending}
        >
          {t('openClub')}
        </Button>
      ) : null}

      <BulkPointsDialog
        open={committeeOpen}
        onOpenChange={setCommitteeOpen}
        kind="committee"
        name={committee.name}
        groups={committeeGroups}
        onSubmit={async ({ batchId, amount, reason, workDate, pairs }) =>
          committeeBulk.mutateAsync({
            batchId,
            amount,
            reason,
            workDate,
            memberIds: pairs.map((pair) => pair.memberId),
          })
        }
      />
      <BulkPointsDialog
        open={clubOpen && roster.data !== undefined}
        onOpenChange={setClubOpen}
        kind="club"
        name={clubName}
        groups={clubGroups}
        onSubmit={async ({ batchId, amount, reason, workDate, pairs }) =>
          clubBulk.mutateAsync({ batchId, amount, reason, workDate, entries: [...pairs] })
        }
      />
    </>
  );
}
