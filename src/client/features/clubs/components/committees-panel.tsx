'use client';

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Code,
  Info,
  Lightbulb,
  Lock,
  Megaphone,
  MoreVertical,
  Palette,
  Plus,
  Rocket,
  RotateCw,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { Link } from '@/i18n/navigation';
import type { Club, Committee } from '@/shared/contracts/clubs';

import { EntityFormDialog } from './entity-form-dialog';
import {
  useCommittees,
  useCreateCommittee,
  useMemberTotal,
  useSetCommitteeArchived,
  useUpdateCommittee,
} from '../hooks/use-clubs';
import type { ClubAccess } from '../lib/access';

interface CommitteesPanelProps {
  club: Club;
  access: ClubAccess;
  includeArchived: boolean;
}

/** Decorative: committees have no icon of their own, so each card takes the next one in turn. */
const ICONS: readonly LucideIcon[] = [
  Users,
  Code,
  Palette,
  CalendarDays,
  Megaphone,
  Rocket,
  Lightbulb,
  BookOpen,
];

/**
 * A club's committees. Only full admins create, rename and archive them (the server answers 403
 * `full_admin_required` to anyone else, club officers included), so everyone else sees a short
 * note saying so beside the title. Officers read all of the club's committees; a committee lead
 * reads only the ones they lead.
 */
export function CommitteesPanel({ club, access, includeArchived }: CommitteesPanelProps) {
  const t = useTranslations('clubs.committees');
  const errorText = useErrorText();
  const committees = useCommittees(club.id, includeArchived);
  const create = useCreateCommittee(club.id);
  const [creating, setCreating] = useState(false);
  const clubArchived = club.archivedAt !== null;

  if (committees.isPending) return <Skeleton className="h-32 w-full" />;
  if (committees.isError) {
    return (
      <EmptyState
        title={errorText(committees.error)}
        action={
          <Button variant="outline" onClick={() => void committees.refetch()}>
            <RotateCw aria-hidden />
            {t('retry')}
          </Button>
        }
      />
    );
  }

  const items = committees.data.items;
  return (
    <section aria-label={t('title')} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">{t('title')}</h3>
          {access.role === 'lead' ? (
            <NotePill icon={Info}>{t('leadOnlyNotice')}</NotePill>
          ) : access.canManageStructure ? null : (
            <NotePill icon={Lock}>{t('readOnlyNotice')}</NotePill>
          )}
        </div>
        {access.canManageStructure ? (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" disabled={clubArchived} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('add')}
            </Button>
            {clubArchived ? (
              <span className="text-xs text-fg-muted">{t('addDisabledArchived')}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('empty')}
          description={access.canManageStructure && !clubArchived ? t('emptyAdmin') : undefined}
        />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {items.map((committee, index) => (
            <CommitteeCard
              key={committee.id}
              committee={committee}
              icon={ICONS[index % ICONS.length] ?? Users}
              clubArchived={clubArchived}
              canManage={access.canManageStructure}
            />
          ))}
        </ul>
      )}

      <EntityFormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('create.title')}
        description={t('create.description', { club: club.name })}
        submitLabel={t('create.submit')}
        labels={{ name: t('fields.name'), description: t('fields.description') }}
        onSubmit={async (values) => {
          await create.mutateAsync({
            name: values.name,
            ...(values.description ? { description: values.description } : {}),
          });
          toast.success(t('toasts.created'));
        }}
      />
    </section>
  );
}

/** A quiet, rounded note with a small icon: information that is not an error. */
function NotePill({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span
      role="note"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1 text-xs font-medium text-fg-muted"
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

function CommitteeCard({
  committee,
  icon: Icon,
  clubArchived,
  canManage,
}: {
  committee: Committee;
  icon: LucideIcon;
  clubArchived: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('clubs.committees');
  const format = useFormatter();
  const update = useUpdateCommittee(committee.id);
  const setArchived = useSetCommitteeArchived(committee.id);
  const members = useMemberTotal({ clubId: committee.clubId, committeeId: committee.id });
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const archived = committee.archivedAt !== null;

  return (
    <li
      data-archived={archived || undefined}
      className="group grid content-between gap-4 rounded-card border border-border bg-surface-1 p-4 transition-[border-color,box-shadow] duration-(--duration-base) hover:border-primary/60 hover:shadow-md data-[archived]:border-dashed data-[archived]:bg-surface-2"
    >
      <div className="grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-fg"
            >
              <Icon className="size-5" />
            </span>
            <h4 className="truncate text-base font-semibold">{committee.name}</h4>
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('actions.label', { name: committee.name })}
                >
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  {t('actions.edit')}
                </DropdownMenuItem>
                {/* Restoring is refused while the club is archived, so the way out is the club. */}
                <DropdownMenuItem
                  disabled={archived && clubArchived}
                  onSelect={() => setConfirming(true)}
                >
                  {archived
                    ? clubArchived
                      ? t('actions.restoreBlocked')
                      : t('actions.restore')
                    : t('actions.archive')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">{committee.description ?? t('noDescription')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Badge variant="neutral" data-testid={`committee-members-${committee.id}`}>
          <UsersRound aria-hidden />
          {members.data === undefined
            ? '…'
            : t('memberCount', { count: format.number(members.data, 'integer') })}
        </Badge>
        {archived ? (
          <Badge variant="outline">{t('archived')}</Badge>
        ) : clubArchived ? (
          <Badge variant="outline">{t('closedByClub')}</Badge>
        ) : (
          <Badge variant="success">{t('statusActive')}</Badge>
        )}
        <Button asChild variant="ghost" size="sm" className="ms-auto">
          <Link
            href={`/dashboard/members?committeeId=${committee.id}`}
            aria-label={t('viewMembersLabel', { name: committee.name })}
          >
            {t('viewMembers')}
            <DirectionalIcon icon={ArrowRight} />
          </Link>
        </Button>
      </div>

      <EntityFormDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('edit.title')}
        description={t('edit.description')}
        submitLabel={t('edit.submit')}
        labels={{ name: t('fields.name'), description: t('fields.description') }}
        initial={{ name: committee.name, description: committee.description ?? '' }}
        onSubmit={async (values) => {
          await update.mutateAsync({
            name: values.name,
            description: values.description === '' ? null : values.description,
          });
          toast.success(t('toasts.updated'));
        }}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(archived ? 'restoreConfirm.title' : 'archiveConfirm.title', {
          name: committee.name,
        })}
        description={t(archived ? 'restoreConfirm.body' : 'archiveConfirm.body')}
        confirmLabel={t(archived ? 'restoreConfirm.confirm' : 'archiveConfirm.confirm')}
        onConfirm={async () => {
          await setArchived.mutateAsync(!archived);
          toast.success(t(archived ? 'toasts.restored' : 'toasts.archived'));
        }}
      />
    </li>
  );
}
