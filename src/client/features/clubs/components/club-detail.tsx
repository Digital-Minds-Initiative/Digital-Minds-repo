'use client';

import { Building2, Layers, MoreVertical, Tags, Users, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import type { Club } from '@/shared/contracts/clubs';

import { CommitteesPanel } from './committees-panel';
import { EntityFormDialog } from './entity-form-dialog';
import { MembershipTypesPanel } from './membership-types-panel';
import {
  useCommittees,
  useMemberTotal,
  useMembershipTypes,
  useSetClubArchived,
  useUpdateClub,
} from '../hooks/use-clubs';
import type { ClubAccess } from '../lib/access';

interface ClubDetailProps {
  club: Club;
  access: ClubAccess;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
}

/**
 * One club: a header card with its identity and three numbers, joined underneath to a control bar
 * that holds the two tabs and the "show archived" switch, then the tab's content. The numbers are
 * read from the same lists the tabs show, limited by the server to what the person may see — a
 * committee lead's member count is the members of their own committees.
 */
export function ClubDetail({
  club,
  access,
  includeArchived,
  onIncludeArchivedChange,
}: ClubDetailProps) {
  const t = useTranslations('clubs.club');
  const tToolbar = useTranslations('clubs.toolbar');
  const update = useUpdateClub(club.id);
  const setArchived = useSetClubArchived(club.id);
  const switchId = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const archived = club.archivedAt !== null;

  return (
    <Tabs defaultValue="committees" className="grid gap-0">
      <article aria-label={club.name} className="grid">
        <header className="grid gap-4 rounded-t-card border border-border bg-surface-1 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary-subtle-fg"
            >
              <Building2 className="size-7" />
            </span>
            <div className="grid min-w-0 gap-2">
              <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                {club.name}
                {archived ? <Badge variant="neutral">{t('archived')}</Badge> : null}
              </h2>
              <p className="text-sm text-fg-muted">{club.description ?? t('noDescription')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  {t('slug')}
                  <code className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-fg [direction:ltr]">
                    {club.slug}
                  </code>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  {t('yourRole')}
                  <Badge variant="primary">{t(`roles.${access.role}`)}</Badge>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 lg:items-center">
            <ClubStats club={club} includeArchived={includeArchived} />
            {access.canManageStructure ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label={t('actions.label')}>
                    <MoreVertical aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    {t('actions.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirming(true)}>
                    {archived ? t('actions.restore') : t('actions.archive')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </header>

        {archived ? (
          <p
            role="note"
            className="border-x border-border bg-surface-3 px-5 py-2 text-sm text-fg-muted"
          >
            {t('archivedNotice')}
          </p>
        ) : null}

        {/* Joined to the card above: the tabs and the archived switch share one bar. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-card border border-t-0 border-border bg-surface-2 px-4 py-2.5">
          <TabsList>
            <TabsTrigger value="committees">{t('tabs.committees')}</TabsTrigger>
            <TabsTrigger value="types">{t('tabs.types')}</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={includeArchived}
              onCheckedChange={onIncludeArchivedChange}
            />
            <Label htmlFor={switchId}>{tToolbar('showArchived')}</Label>
          </div>
        </div>
      </article>

      <TabsContent value="committees" className="pt-5">
        <CommitteesPanel club={club} access={access} includeArchived={includeArchived} />
      </TabsContent>
      <TabsContent value="types" className="pt-5">
        <MembershipTypesPanel club={club} access={access} />
      </TabsContent>

      <EntityFormDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('edit.title')}
        description={t('edit.description')}
        submitLabel={t('edit.submit')}
        labels={{ name: t('fields.name'), description: t('fields.description') }}
        initial={{ name: club.name, description: club.description ?? '' }}
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
        title={t(archived ? 'restoreConfirm.title' : 'archiveConfirm.title', { name: club.name })}
        description={t(archived ? 'restoreConfirm.body' : 'archiveConfirm.body')}
        confirmLabel={t(archived ? 'restoreConfirm.confirm' : 'archiveConfirm.confirm')}
        onConfirm={async () => {
          await setArchived.mutateAsync(!archived);
          toast.success(t(archived ? 'toasts.restored' : 'toasts.archived'));
        }}
      />
    </Tabs>
  );
}

/** Members, committees and membership types of the club, as three small figures. */
function ClubStats({ club, includeArchived }: { club: Club; includeArchived: boolean }) {
  const t = useTranslations('clubs.club.stats');
  const format = useFormatter();
  const members = useMemberTotal({ clubId: club.id });
  const committees = useCommittees(club.id, includeArchived);
  const types = useMembershipTypes(club.id);

  const stats: Array<{ key: string; label: string; value: number | undefined; icon: LucideIcon }> =
    [
      { key: 'members', label: t('members'), value: members.data, icon: Users },
      {
        key: 'committees',
        label: t('committees'),
        value: committees.data?.items.length,
        icon: Layers,
      },
      { key: 'types', label: t('types'), value: types.data?.items.length, icon: Tags },
    ];
  return (
    <dl className="m-0 flex gap-2">
      {stats.map((stat) => (
        <div
          key={stat.key}
          className="grid min-w-20 justify-items-center gap-0.5 rounded-lg bg-surface-2 px-3 py-2"
        >
          <dt className="flex items-center gap-1 text-xs text-fg-muted">
            <stat.icon className="size-3.5" aria-hidden />
            {stat.label}
          </dt>
          <dd
            data-testid={`club-stat-${stat.key}`}
            className="m-0 font-mono text-lg font-bold [direction:ltr]"
          >
            {stat.value === undefined ? (
              <Skeleton className="h-6 w-8" aria-busy />
            ) : (
              format.number(stat.value, 'integer')
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
