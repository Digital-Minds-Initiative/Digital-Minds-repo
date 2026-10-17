'use client';

import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Info,
  MoreVertical,
  Plus,
  RotateCw,
  Tags,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import type { Club, MembershipType } from '@/shared/contracts/clubs';

import { DeleteTypeDialog } from './delete-type-dialog';
import { EntityFormDialog } from './entity-form-dialog';
import {
  useCreateMembershipType,
  useDeleteMembershipType,
  useMembershipTypes,
  useRenameMembershipType,
  useReorderMembershipTypes,
} from '../hooks/use-clubs';
import type { ClubAccess } from '../lib/access';

interface MembershipTypesPanelProps {
  club: Club;
  access: ClubAccess;
}

/**
 * The club's membership types in their display order. They only describe a member and never grant
 * permissions. Officers and full admins add, rename, reorder and delete; a committee lead reads.
 * A type is moved by dragging its handle, with the arrow keys on the handle, or with the up and
 * down buttons — every way sends the whole new order in one request.
 */
export function MembershipTypesPanel({ club, access }: MembershipTypesPanelProps) {
  const t = useTranslations('clubs.types');
  const errorText = useErrorText();
  const types = useMembershipTypes(club.id);
  const create = useCreateMembershipType(club.id);
  const reorder = useReorderMembershipTypes(club.id);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<MembershipType | null>(null);
  const [deleting, setDeleting] = useState<MembershipType | null>(null);
  // The row being dragged and the row it is over, by index, while a drag is in progress.
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const clubArchived = club.archivedAt !== null;

  if (types.isPending) return <Skeleton className="h-40 w-full" />;
  if (types.isError) {
    return (
      <EmptyState
        title={errorText(types.error)}
        action={
          <Button variant="outline" onClick={() => void types.refetch()}>
            <RotateCw aria-hidden />
            {t('retry')}
          </Button>
        }
      />
    );
  }

  const items = [...types.data.items].sort((a, b) => a.order - b.order);
  const canManage = access.canManageTypes;

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(from, 1);
    if (moved === undefined) return;
    ids.splice(to, 0, moved);
    reorder.mutate(ids, {
      onSuccess: () => toast.success(t('toasts.reordered')),
      onError: (error) => {
        const stale =
          error instanceof ApiError &&
          error.details.issues?.some((issue) => issue.code === 'order_mismatch');
        toast.error(stale ? t('toasts.reorderStale') : errorText(error));
      },
    });
  }

  function onHandleKey(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, index - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, index + 1);
    }
  }

  return (
    <section aria-label={t('title')} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
        <div className="grid gap-1">
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Info className="size-4 shrink-0" aria-hidden />
            {t('note')}
          </p>
          {canManage ? null : (
            <p className="ps-6 text-sm font-medium text-fg-muted">{t('readOnlyNotice')}</p>
          )}
        </div>
        {canManage ? (
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
        <EmptyState icon={Tags} title={t('title')} />
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0">
          {items.map((type, index) => (
            <li
              key={type.id}
              draggable={canManage && dragging !== null}
              onDragStart={(event) => {
                // Firefox only starts a drag that carries some data.
                event.dataTransfer?.setData('text/plain', type.id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                setDragging(index);
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) move(dragging, index);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              data-dragging={dragging === index || undefined}
              className={cn(
                'group flex items-center gap-3 rounded-lg border bg-surface-1 px-3 py-2.5 transition-[border-color,background-color,opacity] duration-(--duration-base)',
                over === index && dragging !== null && dragging !== index
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border hover:border-border-strong hover:bg-surface-2',
                dragging === index && 'opacity-50',
              )}
            >
              {canManage ? (
                <button
                  type="button"
                  aria-label={t('dragHandle', { name: type.name })}
                  onKeyDown={(event) => onHandleKey(event, index)}
                  // A row is only draggable once its handle was pressed, so text stays selectable.
                  onPointerDown={() => setDragging(index)}
                  onPointerUp={() => setDragging(null)}
                  className="cursor-grab touch-none rounded-md p-1 text-fg-subtle outline-none hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid active:cursor-grabbing"
                >
                  <GripVertical className="size-4" aria-hidden />
                </button>
              ) : null}
              <span
                aria-label={t('position', { position: index + 1 })}
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle font-mono text-xs font-bold text-primary-subtle-fg [direction:ltr]"
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-medium">{type.name}</span>
                <Badge variant="neutral">
                  <User aria-hidden />
                  {t('members', { count: type.activeMemberCount })}
                </Badge>
                {type.inUse && type.activeMemberCount === 0 ? (
                  <Badge variant="outline">{t('inUseOnly')}</Badge>
                ) : null}
              </span>
              {canManage ? (
                <div
                  role="group"
                  aria-label={t('actions.label', { name: type.name })}
                  className="ms-auto flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('moveUp', { name: type.name })}
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('moveDown', { name: type.name })}
                    disabled={index === items.length - 1 || reorder.isPending}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('actions.menu', { name: type.name })}
                      >
                        <MoreVertical aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(type)}>
                        {t('actions.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDeleting(type)}>
                        {t('actions.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <EntityFormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('create.title')}
        description={t('create.description')}
        submitLabel={t('create.submit')}
        labels={{ name: t('fields.name') }}
        withDescription={false}
        onSubmit={async (values) => {
          await create.mutateAsync(values.name);
          toast.success(t('toasts.created'));
        }}
      />
      <RenameTypeDialog type={renaming} onClose={() => setRenaming(null)} />
      <DeleteType type={deleting} types={items} onClose={() => setDeleting(null)} />
    </section>
  );
}

function RenameTypeDialog({ type, onClose }: { type: MembershipType | null; onClose: () => void }) {
  const t = useTranslations('clubs.types');
  // The hook needs an id; with no type the dialog is closed and the mutation is never used.
  const rename = useRenameMembershipType(type?.id ?? '');
  return (
    <EntityFormDialog
      // Keyed so every type opens its own form with its own current name.
      key={type?.id ?? 'none'}
      open={type !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('rename.title')}
      description={t('rename.description')}
      submitLabel={t('rename.submit')}
      labels={{ name: t('fields.name') }}
      withDescription={false}
      initial={{ name: type?.name ?? '' }}
      onSubmit={async (values) => {
        await rename.mutateAsync(values.name);
        toast.success(t('toasts.renamed'));
      }}
    />
  );
}

function DeleteType({
  type,
  types,
  onClose,
}: {
  type: MembershipType | null;
  types: readonly MembershipType[];
  onClose: () => void;
}) {
  const t = useTranslations('clubs.types');
  const remove = useDeleteMembershipType(type?.id ?? '');
  return (
    <DeleteTypeDialog
      type={type}
      types={types}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onConfirm={async (moveMembersTo) => {
        await remove.mutateAsync(moveMembersTo);
        toast.success(t('toasts.deleted'));
      }}
    />
  );
}
