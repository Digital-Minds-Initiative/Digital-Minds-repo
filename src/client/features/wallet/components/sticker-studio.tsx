'use client';

import { Archive, ArchiveRestore, EyeOff, Palette, Pencil, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { StudioSticker } from '@/shared/contracts/stickers';
import {
  CUSTOM_STICKER_LIMITS,
  STICKER_COLORS,
  STICKER_ICONS,
  STICKER_SHAPES,
  type CustomStickerDef,
  type StickerColor,
  type StickerIcon,
  type StickerShape,
} from '@/shared/lib/stickers';

import { Sticker } from './sticker';
import { useCustomStickers, useStickerStudioActions } from '../hooks/use-custom-stickers';
import { ICON_GLYPHS, STICKER_COLOR_VAR } from '../lib/sticker-art';

interface Draft {
  name: string;
  label: string;
  howTo: string;
  icon: StickerIcon;
  shape: StickerShape;
  background: StickerColor;
  ink: StickerColor;
  hidden: boolean;
  awardableBy: 'LEAD' | 'OFFICER';
}

const BLANK: Draft = {
  name: '',
  label: '',
  howTo: '',
  icon: 'star',
  shape: 'disc',
  background: 'indigo',
  ink: 'white',
  hidden: false,
  awardableBy: 'LEAD',
};

const draftOf = (sticker: StudioSticker): Draft => ({
  name: sticker.name,
  label: sticker.label,
  howTo: sticker.howTo,
  icon: sticker.icon,
  shape: sticker.shape,
  background: sticker.background,
  ink: sticker.ink,
  hidden: sticker.hidden,
  awardableBy: sticker.awardableBy,
});

/** The sticker as the draft would draw it, so the studio and every card show the same thing. */
const previewOf = (draft: Draft): CustomStickerDef => ({
  key: 'custom:00000000-0000-0000-0000-000000000000',
  name: draft.name || '—',
  howTo: draft.howTo,
  label: draft.label || '···',
  icon: draft.icon,
  shape: draft.shape,
  background: draft.background,
  ink: draft.ink,
  hidden: draft.hidden,
});

/** One of the sixteen icons, drawn as its own pixels on a quiet square. */
function IconSwatch({ icon, ink }: { icon: StickerIcon; ink: string }) {
  return (
    <svg viewBox="0 0 40 40" className="size-8" aria-hidden shapeRendering="crispEdges">
      {ICON_GLYPHS[icon].flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '#' ? (
            <rect key={`${x}-${y}`} x={x * 5} y={y * 5} width="5" height="5" fill={ink} />
          ) : null,
        ),
      )}
    </svg>
  );
}

/** A labelled group of choices, announced as one group to a screen reader. */
function Choice({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-semibold">{label}</legend>
      {hint ? <p className="m-0 -mt-1 text-xs text-fg-muted">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/** The studio's editor: the words, the icon, the shape, the colours, who may give it, side by side with the sticker. */
function StickerEditor({
  clubId,
  editing,
  onDone,
}: {
  clubId: string;
  editing: StudioSticker | null;
  onDone: () => void;
}) {
  const t = useTranslations('wallet.studio');
  const [draft, setDraft] = useState<Draft>(editing ? draftOf(editing) : BLANK);
  const { create, update } = useStickerStudioActions(clubId);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const saving = create.isPending || update.isPending;
  const failed = create.isError || update.isError;
  const same = draft.background === draft.ink;
  const incomplete = !draft.name.trim() || !draft.label.trim() || !draft.howTo.trim();

  const save = () => {
    const fields = {
      ...draft,
      name: draft.name.trim(),
      label: draft.label.trim(),
      howTo: draft.howTo.trim(),
    };
    const done = { onSuccess: onDone };
    if (editing) update.mutate({ stickerId: editing.id, changes: fields }, done);
    else create.mutate(fields, done);
  };

  const swatches = (field: 'background' | 'ink') => (
    <div role="radiogroup" aria-label={t(`fields.${field}`)} className="flex flex-wrap gap-2">
      {STICKER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={draft[field] === color}
          aria-label={t(`colors.${color}`)}
          title={t(`colors.${color}`)}
          onClick={() => set(field, color)}
          className={cn(
            'size-9 cursor-pointer rounded-full border border-border-strong transition-transform duration-150 outline-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90 motion-reduce:transition-none',
            draft[field] === color && 'ring-2 ring-primary ring-offset-2 ring-offset-surface-1',
          )}
          style={{ background: STICKER_COLOR_VAR[color] }}
        />
      ))}
    </div>
  );

  return (
    <section
      aria-label={editing ? t('editing', { name: editing.name }) : t('creating')}
      className="grid gap-6 rounded-card border border-border bg-surface-1 p-5 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div className="grid min-w-0 gap-5">
        <h2 className="m-0 text-base font-semibold">
          {editing ? t('editing', { name: editing.name }) : t('creating')}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.name')}
            <Input
              value={draft.name}
              maxLength={CUSTOM_STICKER_LIMITS.name}
              placeholder={t('placeholders.name')}
              onChange={(event) => set('name', event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.label')}
            <Input
              value={draft.label}
              maxLength={CUSTOM_STICKER_LIMITS.label}
              placeholder={t('placeholders.label')}
              onChange={(event) => set('label', event.target.value)}
            />
            <span className="text-xs font-normal text-fg-muted">{t('hints.label')}</span>
          </label>
        </div>

        <label className="grid gap-1.5 text-sm font-semibold">
          {t('fields.howTo')}
          <textarea
            value={draft.howTo}
            maxLength={CUSTOM_STICKER_LIMITS.howTo}
            rows={3}
            placeholder={t('placeholders.howTo')}
            onChange={(event) => set('howTo', event.target.value)}
            className="w-full resize-y rounded-md border border-input bg-surface-1 px-3 py-2 text-sm font-normal text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span className="text-xs font-normal text-fg-muted">
            {t('hints.howTo', { left: CUSTOM_STICKER_LIMITS.howTo - draft.howTo.length })}
          </span>
        </label>

        <Choice label={t('fields.icon')}>
          <div role="radiogroup" aria-label={t('fields.icon')} className="flex flex-wrap gap-2">
            {STICKER_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={draft.icon === icon}
                aria-label={t(`icons.${icon}`)}
                title={t(`icons.${icon}`)}
                onClick={() => set('icon', icon)}
                className={cn(
                  'grid size-12 cursor-pointer place-items-center rounded-lg border border-border bg-surface-2 transition-[transform,background-color] duration-150 outline-none',
                  'hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90 motion-reduce:transition-none',
                  draft.icon === icon && 'border-primary bg-primary-subtle',
                )}
              >
                <IconSwatch icon={icon} ink="currentColor" />
              </button>
            ))}
          </div>
        </Choice>

        <Choice label={t('fields.shape')}>
          <div role="radiogroup" aria-label={t('fields.shape')} className="flex flex-wrap gap-3">
            {STICKER_SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                role="radio"
                aria-checked={draft.shape === shape}
                aria-label={t(`shapes.${shape}`)}
                title={t(`shapes.${shape}`)}
                onClick={() => set('shape', shape)}
                className={cn(
                  'cursor-pointer rounded-xl p-1.5 transition-transform duration-150 outline-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90 motion-reduce:transition-none',
                  draft.shape === shape && 'bg-primary-subtle ring-2 ring-primary',
                )}
              >
                <Sticker
                  stickerKey={previewOf(draft).key}
                  custom={{ ...previewOf(draft), shape }}
                  size={52}
                  label=" "
                />
              </button>
            ))}
          </div>
        </Choice>

        <div className="grid gap-5 sm:grid-cols-2">
          <Choice label={t('fields.background')}>{swatches('background')}</Choice>
          <Choice label={t('fields.ink')}>{swatches('ink')}</Choice>
        </div>
        {same ? (
          <p role="alert" className="m-0 text-sm text-warning">
            {t('hints.sameColour')}
          </p>
        ) : null}

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <label className="flex items-start justify-between gap-4 text-sm">
            <span className="grid gap-0.5">
              <span className="font-semibold">{t('fields.hidden')}</span>
              <span className="text-xs text-fg-muted">{t('hints.hidden')}</span>
            </span>
            <Switch checked={draft.hidden} onCheckedChange={(on) => set('hidden', on)} />
          </label>
          <Choice label={t('fields.awardableBy')}>
            <div role="radiogroup" aria-label={t('fields.awardableBy')} className="grid gap-2">
              {(['LEAD', 'OFFICER'] as const).map((who) => (
                <label key={who} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="awardable-by"
                    checked={draft.awardableBy === who}
                    onChange={() => set('awardableBy', who)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {t(`awardableBy.${who}`)}
                </label>
              ))}
            </div>
          </Choice>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button onClick={save} loading={saving} disabled={incomplete || same}>
            {editing ? t('save') : t('create')}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={saving}>
            {t('cancel')}
          </Button>
          {failed ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {t('failed')}
            </p>
          ) : null}
        </div>
      </div>

      <aside
        aria-label={t('preview')}
        className="grid content-start justify-items-center gap-4 rounded-card bg-surface-2 p-5 lg:sticky lg:top-4"
      >
        <p className="m-0 text-xs font-semibold text-fg-muted">{t('preview')}</p>
        <div className="motion-safe:animate-[sticker-float_5s_ease-in-out_infinite]">
          <Sticker
            stickerKey={previewOf(draft).key}
            custom={previewOf(draft)}
            size={170}
            className="[filter:drop-shadow(0_14px_10px_color-mix(in_oklab,black_28%,transparent))]"
          />
        </div>
        <div className="flex items-end gap-3" aria-hidden>
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={64} />
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={40} />
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={64} locked />
        </div>
        <p className="m-0 text-center text-sm leading-7">
          {draft.howTo || t('hints.previewHowTo')}
        </p>
      </aside>
    </section>
  );
}

/**
 * «استوديو الملصقات»: where a club's leaders design stickers (docs/adr/0033-custom-stickers.md).
 * Pick a club, press «جديد» or an existing sticker: write its name and what is printed on it, pick
 * its icon, shape and colours from the design system's, say how it is got and who may give it, and
 * whether it is a secret. The sticker is drawn live while they work, and the same drawing is what
 * members see on their cards. Stickers are given from a member's file; a sticker already given is
 * archived, never deleted, so it stays on the cards that hold it.
 */
export function StickerStudio() {
  const t = useTranslations('wallet.studio');
  const me = useMe();
  const [chosenClub, setChosenClub] = useState<string | null>(null);
  const [editing, setEditing] = useState<StudioSticker | 'new' | null>(null);

  // The clubs this person may design stickers for: the ones they manage, and the ones where they lead a committee.
  const clubs = useMemo(() => {
    if (!me.data) return [];
    const leading = new Set(
      me.data.memberships
        .filter((membership) =>
          membership.committees.some((committee) => committee.role === 'LEAD'),
        )
        .map((membership) => membership.club.id),
    );
    return me.data.access.clubs.filter(
      (club) => club.canManage || leading.has(club.id) || me.data.user.isFullAdmin,
    );
  }, [me.data]);
  const clubId = chosenClub ?? clubs[0]?.id ?? null;
  const list = useCustomStickers(clubId);
  const { update } = useStickerStudioActions(clubId ?? '');

  if (me.isPending) return <Skeleton className="h-64" />;
  if (clubs.length === 0 || clubId === null) {
    return <EmptyState icon={Palette} title={t('noClub.title')} description={t('noClub.body')} />;
  }

  const stickers = list.data?.stickers ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {clubs.length > 1 ? (
          <label className="grid gap-1 text-sm font-semibold">
            {t('club')}
            <select
              value={clubId}
              onChange={(event) => {
                setChosenClub(event.target.value);
                setEditing(null);
              }}
              className="h-11 rounded-md border border-input bg-surface-1 px-3 text-sm font-normal text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 text-sm font-semibold text-fg-muted">{clubs[0]?.name}</p>
        )}
        {editing === null ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        ) : null}
      </div>

      {editing !== null ? (
        <StickerEditor
          // A different sticker is a different form: its draft starts from that sticker.
          key={editing === 'new' ? 'new' : editing.id}
          clubId={clubId}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}

      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('loadFailed')}
        </p>
      ) : stickers.length === 0 ? (
        <EmptyState icon={Palette} title={t('empty.title')} description={t('empty.body')} />
      ) : (
        <ul
          aria-label={t('listLabel')}
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 p-0"
        >
          {stickers.map((sticker) => (
            <li
              key={sticker.id}
              className={cn(
                'grid content-start justify-items-center gap-3 rounded-card border border-border bg-surface-1 p-4 text-center',
                sticker.archived && 'opacity-60',
              )}
            >
              <Sticker stickerKey={sticker.key} custom={sticker} size={96} />
              <div className="grid gap-1">
                <h3 className="m-0 text-sm font-semibold">{sticker.name}</h3>
                <p className="m-0 text-xs leading-6 text-fg-muted">{sticker.howTo}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {sticker.hidden ? (
                  <Badge variant="info">
                    <EyeOff aria-hidden />
                    {t('badges.hidden')}
                  </Badge>
                ) : null}
                <Badge variant="neutral">
                  <Users aria-hidden />
                  {t(`awardableBy.${sticker.awardableBy}`)}
                </Badge>
                <Badge variant="outline">{t('badges.heldBy', { count: sticker.heldBy })}</Badge>
                {sticker.archived ? <Badge variant="warning">{t('badges.archived')}</Badge> : null}
              </div>
              {sticker.canEdit ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(sticker)}>
                    <Pencil aria-hidden />
                    {t('edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={update.isPending && update.variables?.stickerId === sticker.id}
                    onClick={() =>
                      update.mutate({
                        stickerId: sticker.id,
                        changes: { archived: !sticker.archived },
                      })
                    }
                  >
                    {sticker.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                    {sticker.archived ? t('restore') : t('archive')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {update.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('failed')}
        </p>
      ) : null}
    </div>
  );
}
