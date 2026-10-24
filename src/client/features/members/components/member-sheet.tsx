'use client';

import { Crown, Pencil, RotateCw, ShieldCheck, Trash2, UserMinus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMe } from '@/client/features/auth';
import { useErrorText } from '@/client/lib/use-error-text';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { Member } from '@/shared/contracts/members';

import { DeletePersonDialog } from './delete-person-dialog';
import { MemberCommittees } from './member-committees';
import { useMember } from '../hooks/use-member-actions';
import { memberAccess } from '../lib/access';

export interface MemberSheetProps {
  /** The member whose file is open, or null when the sheet is closed. */
  memberId: string | null;
  onClose: () => void;
  onEdit: (member: Member) => void;
  onRemove: (member: Member) => void;
}

/**
 * One member's file, opened from the table without leaving it: their details in this club, their
 * committees with the points in each, and — for those allowed — the buttons to edit, move between
 * committees and remove. The record is read from the server when the sheet opens, so it is right
 * even for a member who is not on the page that opened it.
 */
export function MemberSheet({ memberId, onClose, onEdit, onRemove }: MemberSheetProps) {
  return (
    <Sheet
      open={memberId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={undefined}>
        <MemberFile memberId={memberId} onEdit={onEdit} onRemove={onRemove} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

function MemberFile({
  memberId,
  onEdit,
  onRemove,
  onClose,
}: {
  memberId: string | null;
  onEdit: (member: Member) => void;
  onRemove: (member: Member) => void;
  onClose: () => void;
}) {
  const t = useTranslations('members.sheet');
  const tRoles = useTranslations('common.roles');
  const tStatus = useTranslations('members.status');
  const tColumns = useTranslations('members');
  const format = useFormatter();
  const errorText = useErrorText();
  const me = useMe();
  const member = useMember(memberId);
  const [deleting, setDeleting] = useState(false);

  if (member.isPending || me.isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>…</SheetTitle>
        </SheetHeader>
        <div aria-busy className="grid gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </>
    );
  }
  if (member.isError || me.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('loadFailed')}</SheetTitle>
        </SheetHeader>
        <EmptyState
          title={errorText(member.error ?? me.error)}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void member.refetch();
                void me.refetch();
              }}
            >
              <RotateCw aria-hidden />
              {t('retry')}
            </Button>
          }
        />
      </>
    );
  }

  const record = member.data;
  const access = memberAccess(me.data, record);
  const removed = record.removedAt !== null;
  // A full admin may delete anyone else's data, removed members included (ADR 0026); the server
  // also refuses another full admin's, which the member record does not say.
  const canDeletePerson = me.data.user.isFullAdmin && record.user.id !== me.data.user.id;
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('fields.club'), value: record.club.name },
    {
      label: t('fields.membershipType'),
      value: <Badge variant="outline">{record.membershipType.name}</Badge>,
    },
    {
      label: t('fields.role'),
      value:
        record.role === 'CLUB_OFFICER' ? (
          <Badge variant="primary">
            <ShieldCheck aria-hidden />
            {tRoles('clubOfficer')}
          </Badge>
        ) : (
          tColumns('none')
        ),
    },
    {
      label: t('fields.email'),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr">{record.user.uniEmail}</bdi>
          <Badge variant={record.user.isRegistered ? 'success' : 'warning'}>
            {record.user.isRegistered ? tStatus('registered') : tStatus('notRegistered')}
          </Badge>
        </span>
      ),
    },
    {
      label: t('fields.personalEmail'),
      value: record.profile.personalEmail ? (
        <bdi dir="ltr">{record.profile.personalEmail}</bdi>
      ) : (
        tColumns('none')
      ),
    },
    {
      label: t('fields.phone'),
      value: record.profile.phone ? <bdi dir="ltr">{record.profile.phone}</bdi> : tColumns('none'),
    },
    { label: t('fields.college'), value: record.profile.college ?? tColumns('none') },
    { label: t('fields.major'), value: record.profile.major ?? tColumns('none') },
    {
      label: t('fields.level'),
      value:
        record.profile.level === null
          ? tColumns('none')
          : tColumns('levelValue', { level: record.profile.level }),
    },
    {
      label: t('fields.points'),
      value: (
        <span className="font-mono [direction:ltr]">{format.number(record.points, 'integer')}</span>
      ),
    },
    {
      label: removed ? t('fields.removedAt') : t('fields.joinedAt'),
      value: format.dateTime(new Date(record.removedAt ?? record.joinedAt), 'dateShort'),
    },
  ];

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {record.user.fullName}
          {removed ? <Badge variant="danger">{tStatus('removed')}</Badge> : null}
        </SheetTitle>
        <SheetDescription>{t('description')}</SheetDescription>
      </SheetHeader>

      {removed ? (
        <p role="note" className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg-muted">
          {t('removedNotice')}
        </p>
      ) : null}

      {!removed && (access.canManage || access.canChangeType) ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(record)}>
            <Pencil aria-hidden />
            {t('edit')}
          </Button>
          {access.canManage ? (
            <Button variant="danger" size="sm" onClick={() => onRemove(record)}>
              <UserMinus aria-hidden />
              {t('remove')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section aria-label={t('sections.details')} className="grid gap-1">
        <h3 className="text-sm font-semibold">{t('sections.details')}</h3>
        <dl className="m-0 grid gap-2 rounded-card border border-border bg-surface-1 p-4 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">{row.label}</dt>
              <dd className="m-0 min-w-0 text-end font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label={t('sections.committees')} className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Crown className="size-4 text-primary" aria-hidden />
          {t('sections.committees')}
        </h3>
        <MemberCommittees member={record} canManage={access.canManage} />
      </section>

      {canDeletePerson ? (
        <div className="border-t border-border pt-4">
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden />
            {t('deletePerson')}
          </Button>
          <DeletePersonDialog
            member={record}
            open={deleting}
            onOpenChange={setDeleting}
            onDeleted={onClose}
          />
        </div>
      ) : null}
    </>
  );
}
