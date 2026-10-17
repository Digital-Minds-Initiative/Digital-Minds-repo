'use client';

import { Crown, UserMinus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import type { Member } from '@/shared/contracts/members';

import {
  useAddToCommittee,
  useClubCommittees,
  useRemoveFromCommittee,
} from '../hooks/use-member-actions';

interface MemberCommitteesProps {
  member: Member;
  /** May add to and remove from committees (club officers and full admins). */
  canManage: boolean;
}

/**
 * The committees the member is in — only the ones the signed-in person is allowed to see — with
 * each one's points. Officers and full admins also add the member to a committee of the club and
 * take them out; leaving a committee keeps the points, and coming back restores them.
 */
export function MemberCommittees({ member, canManage }: MemberCommitteesProps) {
  const t = useTranslations('members.sheet.committees');
  const format = useFormatter();
  const errorText = useErrorText();
  const committees = useClubCommittees(canManage ? member.club.id : undefined);
  const add = useAddToCommittee(member.id);
  const remove = useRemoveFromCommittee(member.id);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const inIds = new Set(member.committees.map((committee) => committee.id));
  const available = (committees.data?.items ?? []).filter((committee) => !inIds.has(committee.id));

  async function addToChosen() {
    if (!choice) return;
    setError(null);
    try {
      await add.mutateAsync(choice);
      setChoice('');
      toast.success(t('added'));
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="grid gap-3">
      {member.committees.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {member.committees.map((committee) => (
            <li
              key={committee.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{committee.name}</span>
                {committee.role === 'LEAD' ? (
                  <Badge variant="info">
                    <Crown aria-hidden />
                    {t('leadBadge')}
                  </Badge>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm text-fg-muted [direction:ltr]">
                  {t('points', { points: format.number(committee.points, 'integer') })}
                </span>
                {canManage && !member.removedAt ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('remove', {
                      name: member.user.fullName,
                      committee: committee.name,
                    })}
                    onClick={() => setRemoving({ id: committee.id, name: committee.name })}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && !member.removedAt ? (
        available.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="w-56" aria-label={t('add')}>
                <SelectValue placeholder={t('addPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {available.map((committee) => (
                  <SelectItem key={committee.id} value={committee.id}>
                    {committee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!choice}
              loading={add.isPending}
              onClick={() => void addToChosen()}
            >
              {t('add')}
            </Button>
          </div>
        ) : committees.data ? (
          <p className="text-xs text-fg-muted">{t('addAll')}</p>
        ) : null
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        variant="danger"
        title={t('removeConfirm.title', {
          name: member.user.fullName,
          committee: removing?.name ?? '',
        })}
        description={t('removeConfirm.body')}
        confirmLabel={t('removeConfirm.confirm')}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.id);
          toast.success(t('removed'));
        }}
      />
    </div>
  );
}
