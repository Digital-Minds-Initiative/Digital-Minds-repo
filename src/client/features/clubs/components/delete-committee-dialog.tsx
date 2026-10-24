'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { TypedConfirmDialog } from '@/components/patterns/typed-confirm-dialog';
import { toast } from '@/components/ui/toaster';
import type { Committee } from '@/shared/contracts/clubs';
import type { CommitteeDeletionPreview } from '@/shared/contracts/deletions';

import { useCommitteeDeletionPreview, useDeleteCommittee } from '../hooks/use-clubs';

export interface DeleteCommitteeDialogProps {
  committee: Committee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deleting a committee for good (ADR 0015), a full admin's action. The counts come from the
 * server when the dialog opens: an empty committee only needs a confirm, one with members or
 * points shows what will go and opens the button only once the committee's name is typed. The
 * delete sends the counts that were shown, so if the committee changed meanwhile the server
 * refuses (409 `deletion_counts_changed`) and the dialog shows the new numbers.
 */
export function DeleteCommitteeDialog({
  committee,
  open,
  onOpenChange,
}: DeleteCommitteeDialogProps) {
  const t = useTranslations('clubs.committees.deleteConfirm');
  const tToasts = useTranslations('clubs.committees.toasts');
  const format = useFormatter();
  const preview = useCommitteeDeletionPreview(committee.id, open);
  const remove = useDeleteCommittee(committee.id);

  async function confirm(expected: CommitteeDeletionPreview, name: string) {
    try {
      await remove.mutateAsync({ name, expected });
    } catch (error) {
      void preview.refetch();
      throw error;
    }
    toast.success(tToasts('deleted'));
  }

  const counts = preview.data;
  const title = t('title', { name: committee.name });
  if (!counts || (counts.committeeMemberships === 0 && counts.pointTransactions === 0)) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        variant="danger"
        title={title}
        description={counts ? t('emptyBody') : t('loading')}
        confirmLabel={t('confirm')}
        // Until the counts are known, the dialog cannot tell which confirmation it needs.
        confirmDisabled={!counts}
        onConfirm={() => (counts ? confirm(counts, committee.name) : Promise.resolve())}
      />
    );
  }

  return (
    <TypedConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={t('dataBody', {
        memberships: format.number(counts.committeeMemberships, 'integer'),
        transactions: format.number(counts.pointTransactions, 'integer'),
      })}
      expected={committee.name}
      inputLabel={t('typeName', { name: committee.name })}
      confirmLabel={t('confirm')}
      onConfirm={(typed) => confirm(counts, typed)}
    >
      <p className="text-sm text-fg-muted">{t('irreversible')}</p>
    </TypedConfirmDialog>
  );
}
