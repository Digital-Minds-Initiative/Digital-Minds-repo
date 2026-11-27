'use client';

import {
  Archive,
  ArchiveRestore,
  ChartColumn,
  EyeOff,
  Palette,
  Pencil,
  Plus,
  Users,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { StudioSticker } from '@/shared/contracts/stickers';
import {
  CUSTOM_STICKER_LIMITS,
  STICKER_COLORS,
  STICKER_ICONS,
  STICKER_RARITIES,
  STICKER_SHAPES,
  type CustomStickerDef,
  type StickerColor,
  type StickerIcon,
  type StickerRarity,
  type StickerShape,
} from '@/shared/lib/stickers';

import { ClaimsPanel } from './claims-panel';
import { Sticker } from './sticker';
import {
  useCustomStickers,
  useStickerStats,
  useStickerStudioActions,
} from '../hooks/use-custom-stickers';
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
  rarity: StickerRarity;
  /** A seasonal sticker: given only between the two moments below (local date and time, or empty). */
  seasonal: boolean;
  from: string;
  until: string;
  /** The most members who may hold it, as typed; empty for no limit. */
  maxHolders: string;
}

/** An ISO instant as the text a `datetime-local` input holds (the viewer's own clock). */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

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
  rarity: 'COMMON',
  seasonal: false,
  from: '',
  until: '',
  maxHolders: '',
};

/** Ready-made starting points, so a leader begins from a sticker and not from a blank page. */
const TEMPLATES: ReadonlyArray<{
  key: 'achievement' | 'attendance' | 'learning' | 'thanks' | 'season' | 'builder';
  draft: Partial<Draft>;
}> = [
  {
    key: 'achievement',
    draft: { icon: 'trophy', shape: 'shield', background: 'indigo', ink: 'white', rarity: 'RARE' },
  },
  { key: 'attendance', draft: { icon: 'mic', shape: 'hex', background: 'orange', ink: 'deep' } },
  { key: 'learning', draft: { icon: 'book', shape: 'square', background: 'peach', ink: 'indigo' } },
  { key: 'thanks', draft: { icon: 'heart', shape: 'disc', background: 'rose', ink: 'white' } },
  {
    key: 'season',
    draft: {
      icon: 'moon',
      shape: 'disc',
      background: 'deep',
      ink: 'gold',
      rarity: 'LEGENDARY',
      seasonal: true,
    },
  },
  {
    key: 'builder',
    draft: { icon: 'code', shape: 'hex', background: 'deep', ink: 'teal', rarity: 'RARE' },
  },
];

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
  rarity: sticker.rarity,
  seasonal: sticker.availableFrom !== null || sticker.availableUntil !== null,
  from: toLocalInput(sticker.availableFrom),
  until: toLocalInput(sticker.availableUntil),
  maxHolders: sticker.maxHolders === null ? '' : String(sticker.maxHolders),
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
  rarity: draft.rarity,
  availableFrom: draft.seasonal ? toIso(draft.from) : null,
  availableUntil: draft.seasonal ? toIso(draft.until) : null,
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

/**
 * The sticker on a light card and a dark one, at the size it has on a real card: so a leader sees
 * whether it reads on both before it is saved.
 */
function CardPreview({ sticker }: { sticker: CustomStickerDef }) {
  const t = useTranslations('wallet.studio');
  return (
    <div className="grid w-full gap-2">
      <p className="m-0 text-xs font-semibold text-fg-muted">{t('onCard')}</p>
      <div className="grid grid-cols-2 gap-3" aria-hidden>
        {(['paper', 'matte'] as const).map((tone) => (
          <div
            key={tone}
            className="relative h-28 overflow-hidden rounded-xl border border-border"
            style={{
              background: tone === 'paper' ? 'var(--badge-white)' : 'var(--badge-ink)',
              color: tone === 'paper' ? 'var(--badge-ink)' : 'var(--badge-white)',
            }}
          >
            <div className="absolute start-3 top-3 h-2 w-12 rounded-sm bg-current opacity-30" />
            <div className="absolute start-3 top-7 h-2 w-20 rounded-sm bg-current opacity-15" />
            <div className="absolute end-3 bottom-2">
              <Sticker stickerKey={sticker.key} custom={sticker} size={56} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The header of a floating window: its title, and a way out that stays in view while the body scrolls. */
function WindowHeader({ title, description }: { title: string; description: string }) {
  const t = useTranslations('wallet.studio');
  return (
    <div className="sticky -top-4 z-20 -mx-4 -mt-4 flex items-start justify-between gap-3 border-b border-border bg-overlay px-4 py-3 sm:-top-6 sm:-mx-6 sm:-mt-6 sm:px-6">
      <DialogHeader className="min-w-0 pe-0">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogClose asChild>
        <Button variant="outline" size="icon" aria-label={t('close')} title={t('close')}>
          <X aria-hidden />
        </Button>
      </DialogClose>
    </div>
  );
}

/** The window's own frame: blurred page behind it, room for a live preview and a long form. */
const WINDOW =
  'top-[3vh] max-h-[94vh] translate-y-0 grid-cols-[minmax(0,1fr)] content-start overflow-y-auto p-4 sm:top-[4vh] sm:p-6';

/** How a sticker is doing: who holds it, how many stuck it on, when it was given, who gave it most. */
function StickerStats({ sticker }: { sticker: StudioSticker }) {
  const t = useTranslations('wallet.studio');
  const format = useFormatter();
  const { data, isPending, isError } = useStickerStats(sticker.id);
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (isError) return <p className="m-0 text-sm text-danger">{t('stats.failed')}</p>;
  const best = Math.max(1, ...data.byMonth.map((entry) => entry.count));
  const cap = sticker.maxHolders;
  return (
    <div className="grid gap-6">
      <dl className="m-0 grid grid-cols-3 gap-3 text-center">
        {(
          [
            ['heldBy', data.heldBy],
            ['percentOfMembers', `${data.percentOfMembers}%`],
            ['placedPercent', `${data.placedPercent}%`],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="grid gap-1 rounded-card bg-surface-2 p-3 sm:p-4">
            <dd className="m-0 font-mono text-2xl font-semibold sm:text-3xl" dir="ltr">
              {value}
            </dd>
            <dt className="text-xs text-fg-muted sm:text-sm">{t(`stats.${key}`)}</dt>
          </div>
        ))}
      </dl>

      {cap !== null ? (
        <div className="grid gap-2">
          <div className="flex justify-between text-sm">
            <span>{t('stats.cap')}</span>
            <span className="font-mono text-fg-muted" dir="ltr">
              {data.heldBy} / {cap}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, (data.heldBy / cap) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      <section aria-label={t('stats.byMonth')} className="grid gap-3">
        <h3 className="m-0 text-sm font-semibold">{t('stats.byMonth')}</h3>
        <div className="flex h-36 items-end gap-2 sm:gap-3" dir="ltr">
          {data.byMonth.map((entry) => {
            const [year, month] = entry.month.split('-').map(Number) as [number, number];
            return (
              <div key={entry.month} className="flex h-full flex-1 flex-col items-center gap-1">
                <span className="font-mono text-xs text-fg-muted">{entry.count}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    title={`${entry.month}: ${entry.count}`}
                    className="w-full rounded-t-md bg-primary"
                    style={{
                      height: `${Math.max(4, (entry.count / best) * 100)}%`,
                      opacity: entry.count ? 1 : 0.25,
                    }}
                  />
                </div>
                <span className="text-[11px] text-fg-muted">
                  {format.dateTime(new Date(Date.UTC(year, month - 1, 1)), {
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label={t('stats.givers')} className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('stats.givers')}</h3>
        {data.givers.length === 0 ? (
          <p className="m-0 text-sm text-fg-muted">{t('stats.noGivers')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            {data.givers.map((giver) => (
              <li
                key={giver.name}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="min-w-0 truncate">{giver.name}</span>
                <span className="font-mono text-fg-muted" dir="ltr">
                  {giver.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The numbers of one sticker in a floating page of their own, so the list behind it stays where it was. */
function StatsWindow({ sticker, onClose }: { sticker: StudioSticker; onClose: () => void }) {
  const t = useTranslations('wallet.studio');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hideCloseButton
        overlayClassName="backdrop-blur-md"
        className={cn(WINDOW, 'max-w-3xl')}
      >
        <WindowHeader
          title={t('stats.of', { name: sticker.name })}
          description={t('stats.title')}
        />
        <div className="grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="justify-self-center motion-safe:animate-[sticker-float_5s_ease-in-out_infinite]">
            <Sticker
              stickerKey={sticker.key}
              custom={sticker}
              size={120}
              className="[filter:drop-shadow(0_12px_9px_color-mix(in_oklab,black_28%,transparent))]"
            />
          </div>
          <div className="grid gap-2">
            <p className="m-0 text-sm leading-7 text-fg-muted">{sticker.howTo}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="neutral">{t(`rarities.${sticker.rarity}`)}</Badge>
              <Badge variant="neutral">
                <Users aria-hidden />
                {t(`awardableBy.${sticker.awardableBy}`)}
              </Badge>
              {sticker.hidden ? (
                <Badge variant="info">
                  <EyeOff aria-hidden />
                  {t('badges.hidden')}
                </Badge>
              ) : null}
              {sticker.archived ? <Badge variant="warning">{t('badges.archived')}</Badge> : null}
            </div>
          </div>
        </div>
        <StickerStats sticker={sticker} />
      </DialogContent>
    </Dialog>
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

  const seasonBroken =
    draft.seasonal && draft.from !== '' && draft.until !== '' && draft.from >= draft.until;
  const capBroken =
    draft.maxHolders !== '' &&
    !(Number.isInteger(Number(draft.maxHolders)) && Number(draft.maxHolders) >= 1);

  const saving = create.isPending || update.isPending;
  const failed = create.isError || update.isError;
  const same = draft.background === draft.ink;
  const incomplete =
    !draft.name.trim() || !draft.label.trim() || !draft.howTo.trim() || seasonBroken || capBroken;

  const save = () => {
    const fields = {
      name: draft.name.trim(),
      label: draft.label.trim(),
      howTo: draft.howTo.trim(),
      icon: draft.icon,
      shape: draft.shape,
      background: draft.background,
      ink: draft.ink,
      hidden: draft.hidden,
      awardableBy: draft.awardableBy,
      rarity: draft.rarity,
      availableFrom: draft.seasonal ? toIso(draft.from) : null,
      availableUntil: draft.seasonal ? toIso(draft.until) : null,
      maxHolders: draft.maxHolders === '' ? null : Number(draft.maxHolders),
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
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div className="grid min-w-0 gap-5">
        {editing ? null : (
          <Choice label={t('templates.title')} hint={t('templates.hint')}>
            <div className="flex flex-wrap gap-3">
              {TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() =>
                    setDraft({ ...BLANK, ...template.draft, name: t(`templates.${template.key}`) })
                  }
                  className="grid cursor-pointer justify-items-center gap-1 rounded-xl p-1.5 text-xs font-medium transition-transform duration-150 outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90 motion-reduce:transition-none"
                >
                  <Sticker
                    stickerKey={previewOf(BLANK).key}
                    custom={previewOf({ ...BLANK, ...template.draft })}
                    size={56}
                    label=" "
                  />
                  {t(`templates.${template.key}`)}
                </button>
              ))}
            </div>
          </Choice>
        )}

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

        <div className="grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
          <Choice label={t('fields.rarity')}>
            <div role="radiogroup" aria-label={t('fields.rarity')} className="flex flex-wrap gap-2">
              {STICKER_RARITIES.map((rarity) => (
                <button
                  key={rarity}
                  type="button"
                  role="radio"
                  aria-checked={draft.rarity === rarity}
                  onClick={() => set('rarity', rarity)}
                  className={cn(
                    'cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors outline-none',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    draft.rarity === rarity
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'bg-surface-2 text-fg-muted hover:text-fg',
                  )}
                >
                  {t(`rarities.${rarity}`)}
                </button>
              ))}
            </div>
          </Choice>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.maxHolders')}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              dir="ltr"
              value={draft.maxHolders}
              placeholder={t('placeholders.maxHolders')}
              aria-invalid={capBroken}
              onChange={(event) => set('maxHolders', event.target.value)}
            />
            <span className="text-xs font-normal text-fg-muted">{t('hints.maxHolders')}</span>
          </label>
          <div className="grid gap-3 sm:col-span-2">
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="grid gap-0.5">
                <span className="font-semibold">{t('fields.seasonal')}</span>
                <span className="text-xs text-fg-muted">{t('hints.seasonal')}</span>
              </span>
              <Switch checked={draft.seasonal} onCheckedChange={(on) => set('seasonal', on)} />
            </label>
            {draft.seasonal ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold">
                  {t('fields.from')}
                  <Input
                    type="datetime-local"
                    dir="ltr"
                    value={draft.from}
                    onChange={(event) => set('from', event.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  {t('fields.until')}
                  <Input
                    type="datetime-local"
                    dir="ltr"
                    value={draft.until}
                    aria-invalid={seasonBroken}
                    onChange={(event) => set('until', event.target.value)}
                  />
                </label>
                {seasonBroken ? (
                  <p role="alert" className="m-0 text-sm text-warning sm:col-span-2">
                    {t('hints.seasonOrder')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

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
        className="grid content-start justify-items-center gap-4 rounded-card bg-surface-2 p-4 max-lg:order-first lg:sticky lg:top-4 lg:p-5"
      >
        <p className="m-0 text-xs font-semibold text-fg-muted">{t('preview')}</p>
        <div className="motion-safe:animate-[sticker-float_5s_ease-in-out_infinite]">
          <Sticker
            stickerKey={previewOf(draft).key}
            custom={previewOf(draft)}
            size={150}
            className="[filter:drop-shadow(0_14px_10px_color-mix(in_oklab,black_28%,transparent))]"
          />
        </div>
        <div className="flex items-end gap-3 max-lg:hidden" aria-hidden>
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={64} />
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={40} />
          <Sticker stickerKey={previewOf(draft).key} custom={previewOf(draft)} size={64} locked />
        </div>
        <p className="m-0 text-center text-sm leading-7 max-lg:hidden">
          {draft.howTo || t('hints.previewHowTo')}
        </p>
        <div className="w-full max-lg:hidden">
          <CardPreview sticker={previewOf(draft)} />
        </div>
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
  const [statsFor, setStatsFor] = useState<StudioSticker | null>(null);

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
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {t('new')}
        </Button>
      </div>

      {/* The editor floats over a blurred studio: the list behind it never moves while it is open. */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          hideCloseButton
          overlayClassName="backdrop-blur-md"
          className={cn(WINDOW, 'max-w-5xl')}
        >
          <WindowHeader
            title={
              editing === null || editing === 'new'
                ? t('creating')
                : t('editing', { name: editing.name })
            }
            description={t('description')}
          />
          {editing !== null ? (
            <StickerEditor
              // A different sticker is a different form: its draft starts from that sticker.
              key={editing === 'new' ? 'new' : editing.id}
              clubId={clubId}
              editing={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {statsFor ? <StatsWindow sticker={statsFor} onClose={() => setStatsFor(null)} /> : null}

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
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-4 p-0"
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
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setStatsFor(sticker)}>
                  <ChartColumn aria-hidden />
                  {t('statsButton')}
                </Button>
                {sticker.canEdit ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {update.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('failed')}
        </p>
      ) : null}
      <ClaimsPanel clubId={clubId} stickers={stickers} />
    </div>
  );
}
