'use client';

import { Building2, Plus, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

import { ClubDetail } from './club-detail';
import { EntityFormDialog } from './entity-form-dialog';
import { useClubs, useCreateClub } from '../hooks/use-clubs';
import { clubAccess } from '../lib/access';

/**
 * The clubs screen. Everyone sees the clubs inside their own scope; what they can change differs
 * per club (see `clubAccess`). An officer whose only club is archived gets an empty list from the
 * server, so that case has its own message that points at "show archived".
 */
export function ClubsScreen() {
  const t = useTranslations('clubs');
  const errorText = useErrorText();
  const toggleId = useId();
  const me = useMe();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const clubs = useClubs(includeArchived);
  const createClub = useCreateClub();

  if (clubs.isPending || me.isPending) {
    return (
      <div className="grid gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (clubs.isError || me.isError) {
    return (
      <EmptyState
        title={t('states.loadFailed')}
        description={errorText(clubs.error ?? me.error)}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void clubs.refetch();
              void me.refetch();
            }}
          >
            <RotateCw aria-hidden />
            {t('states.retry')}
          </Button>
        }
      />
    );
  }

  const isFullAdmin = me.data.user.isFullAdmin;
  const items = clubs.data.items;
  const selected = items.find((club) => club.id === selectedId) ?? items[0];

  return (
    <div className="grid gap-5">
      {/* With a club open the archived switch sits in that club's control bar; without one it stays here. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {selected ? (
          <span />
        ) : (
          <div className="flex items-center gap-2">
            <Switch id={toggleId} checked={includeArchived} onCheckedChange={setIncludeArchived} />
            <Label htmlFor={toggleId}>{t('toolbar.showArchived')}</Label>
          </div>
        )}
        {isFullAdmin ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('toolbar.addClub')}
          </Button>
        ) : null}
      </div>

      {!selected ? (
        <EmptyClubs
          isFullAdmin={isFullAdmin}
          showingArchived={includeArchived}
          onShowArchived={() => setIncludeArchived(true)}
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[16rem_1fr]">
          {items.length > 1 ? (
            <nav aria-label={t('toolbar.clubsLabel')}>
              <ul className="m-0 grid list-none gap-2 p-0">
                {items.map((club) => (
                  <li key={club.id}>
                    <button
                      type="button"
                      aria-current={club.id === selected.id ? 'true' : undefined}
                      onClick={() => setSelectedId(club.id)}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-start text-sm font-medium transition-colors',
                        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                        club.id === selected.id
                          ? 'border-primary bg-primary-subtle text-primary-subtle-fg'
                          : 'border-border bg-surface-1 text-fg hover:bg-surface-3',
                      )}
                    >
                      <span className="truncate">{club.name}</span>
                      {club.archivedAt ? (
                        <Badge variant="neutral">{t('club.archived')}</Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className={cn('min-w-0', items.length > 1 ? '' : 'lg:col-span-2')}>
            {/* Keyed by club so switching clubs never carries one club's open dialogs or tab over. */}
            <ClubDetail
              key={selected.id}
              club={selected}
              access={clubAccess(me.data, selected.id)}
              includeArchived={includeArchived}
              onIncludeArchivedChange={setIncludeArchived}
            />
          </div>
        </div>
      )}

      <EntityFormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('club.create.title')}
        description={t('club.create.description')}
        submitLabel={t('club.create.submit')}
        labels={{
          name: t('club.fields.name'),
          slug: t('club.fields.slug'),
          slugHint: t('club.fields.slugHint'),
          description: t('club.fields.description'),
        }}
        withSlug
        onSubmit={async (values) => {
          const club = await createClub.mutateAsync({
            name: values.name,
            slug: values.slug,
            ...(values.description ? { description: values.description } : {}),
          });
          setSelectedId(club.id);
          toast.success(t('club.toasts.created'));
        }}
      />
    </div>
  );
}

function EmptyClubs({
  isFullAdmin,
  showingArchived,
  onShowArchived,
}: {
  isFullAdmin: boolean;
  showingArchived: boolean;
  onShowArchived: () => void;
}) {
  const t = useTranslations('clubs.states');
  if (isFullAdmin) {
    return (
      <EmptyState
        icon={Building2}
        title={t('noClubsAdmin.title')}
        description={t('noClubsAdmin.body')}
      />
    );
  }
  // Not an admin and nothing listed: most likely the only club is archived, unless archived ones
  // are already shown — then there is really nothing in this person's scope.
  if (!showingArchived) {
    return (
      <EmptyState
        icon={Building2}
        title={t('noClubsArchived.title')}
        description={t('noClubsArchived.body')}
        action={
          <Button variant="outline" onClick={onShowArchived}>
            {t('noClubsArchived.action')}
          </Button>
        }
      />
    );
  }
  return <EmptyState icon={Building2} title={t('noClubs.title')} description={t('noClubs.body')} />;
}
