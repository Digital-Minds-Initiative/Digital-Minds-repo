'use client';

import { useTranslations } from 'next-intl';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { toast } from '@/components/ui/toaster';
import type { Member } from '@/shared/contracts/members';

import { useRemoveMember } from '../hooks/use-member-actions';

export interface RemoveMemberDialogProps {
  member: Member | null;
  onClose: () => void;
  /** Called after the member was removed, so a file open for them can close. */
  onRemoved?: (memberId: string) => void;
}

/**
 * Asks before taking a person out of the club. It is the soft removal: they leave the club and
 * its committees and lose their roles, while their account, other clubs and points history stay,
 * and adding them again restores it all.
 */
export function RemoveMemberDialog({ member, onClose, onRemoved }: RemoveMemberDialogProps) {
  const t = useTranslations('members.sheet.removeConfirm');
  const remove = useRemoveMember(member?.id ?? '');
  return (
    <ConfirmDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="danger"
      title={t('title', { name: member?.user.fullName ?? '' })}
      description={t('body')}
      confirmLabel={t('confirm')}
      onConfirm={async () => {
        if (!member) return;
        await remove.mutateAsync();
        toast.success(t('done'));
        onRemoved?.(member.id);
      }}
    />
  );
}
