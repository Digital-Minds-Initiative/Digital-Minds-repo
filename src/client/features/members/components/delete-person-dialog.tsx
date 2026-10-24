'use client';

import { useTranslations } from 'next-intl';

import { TypedConfirmDialog } from '@/components/patterns/typed-confirm-dialog';
import { toast } from '@/components/ui/toaster';
import type { Member } from '@/shared/contracts/members';

import { useDeletePerson } from '../hooks/use-member-actions';

export interface DeletePersonDialogProps {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the person is gone, so the file open for them can close. */
  onDeleted: () => void;
}

/**
 * Deleting a person's data for good (ADR 0026), a full admin's action for privacy requests and
 * mistakes. It says what goes — in every club, not only this one — and what stays, and asks for
 * the person's university email before the button opens. The server compares the address again
 * and refuses the admin's own data and another full admin's.
 */
export function DeletePersonDialog({
  member,
  open,
  onOpenChange,
  onDeleted,
}: DeletePersonDialogProps) {
  const t = useTranslations('members.sheet.deletePersonConfirm');
  const remove = useDeletePerson(member.id);
  const email = member.user.uniEmail;

  return (
    <TypedConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: member.user.fullName })}
      description={t('body')}
      expected={email}
      normalize={(value) => value.trim().toLowerCase()}
      inputDir="ltr"
      inputLabel={t('typeEmail', { email })}
      confirmLabel={t('confirm')}
      onConfirm={async (typed) => {
        await remove.mutateAsync({ uniEmail: typed });
        toast.success(t('done'));
        onDeleted();
      }}
    >
      <div className="grid gap-3 text-sm">
        <section className="grid gap-1">
          <h3 className="font-semibold text-danger">{t('removedTitle')}</h3>
          <ul className="m-0 grid list-disc gap-1 ps-5 text-fg-muted">
            <li>{t('removedIdentity')}</li>
            <li>{t('removedMemberships')}</li>
            <li>{t('removedSessions')}</li>
          </ul>
        </section>
        <section className="grid gap-1">
          <h3 className="font-semibold">{t('keptTitle')}</h3>
          <ul className="m-0 grid list-disc gap-1 ps-5 text-fg-muted">
            <li>{t('kept')}</li>
            <li>{t('emailFree')}</li>
          </ul>
        </section>
      </div>
    </TypedConfirmDialog>
  );
}
