'use client';

import { useQuery } from '@tanstack/react-query';
import { IdCard, Lock, Moon, QrCode, Sparkles, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { apiClient } from '@/client/lib/api-client';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import { publicCardEndpoint, type PublicCard } from '@/shared/contracts/cards';
import type { MemberCard } from '@/shared/contracts/wallet';
import { cardToneFor } from '@/shared/lib/member-card';
import {
  defaultPlacement,
  MAX_PLACED_STICKERS,
  STICKER_KEYS,
  type StickerKey,
  type StickerPlacement,
} from '@/shared/lib/stickers';
import { cardRoleLabel } from '@/shared/lib/wallet-pass';

import { MemberBadge, type BadgeEditor } from './member-badge';
import { PublicCardView } from './public-card-page';
import { Sticker } from './sticker';
import { useCardActions } from '../hooks/use-card-actions';

type Tone = 'paper' | 'matte';
type View = 'card' | 'qr';

const placedOf = (card: MemberCard): StickerPlacement[] =>
  card.stickers.flatMap((sticker) => sticker.placement ?? []);

const sameLayout = (a: readonly StickerPlacement[], b: readonly StickerPlacement[]) =>
  JSON.stringify([...a].sort((x, y) => x.key.localeCompare(y.key))) ===
  JSON.stringify([...b].sort((x, y) => x.key.localeCompare(y.key)));

/** The token the QR's address ends with: `/c/<token>`. */
function tokenOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

const TONES: readonly { value: Tone | null; key: 'role' | 'paper' | 'matte'; Icon: LucideIcon }[] =
  [
    { value: null, key: 'role', Icon: Sparkles },
    { value: 'paper', key: 'paper', Icon: Sun },
    { value: 'matte', key: 'matte', Icon: Moon },
  ];

/**
 * The card's colour as three icons: the role's own, the white badge (sun) and the matte one
 * (moon). Pressing one lets the new colour spread over the card from that button.
 */
function ToneSwitch({
  tone,
  onChange,
}: {
  tone: Tone | null;
  onChange: (tone: Tone | null, origin: { x: number; y: number }) => void;
}) {
  const t = useTranslations('wallet.editor');
  return (
    <div
      role="group"
      aria-label={t('tone.title')}
      title={t('tone.help')}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 p-1"
    >
      {TONES.map(({ value, key, Icon }) => {
        const on = tone === value;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            aria-label={t(`tone.${key}`)}
            title={t(`tone.${key}`)}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              // A key press has no pointer: the colour then spreads from the button itself.
              onChange(
                value,
                event.detail === 0
                  ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
                  : { x: event.clientX, y: event.clientY },
              );
            }}
            className={cn(
              'grid size-10 cursor-pointer place-items-center rounded-full outline-none',
              'transition-[background-color,color,transform] duration-200 ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90 motion-reduce:transition-none',
              on
                ? 'bg-primary text-primary-fg shadow-sm'
                : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'size-[18px]',
                on && 'motion-safe:animate-[tone-icon_480ms_var(--ease-out)]',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/** A section of the editor, switched from the row at its top. */
function ViewTabs({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const t = useTranslations('wallet.editor.tabs');
  const tabs: readonly { id: View; Icon: LucideIcon }[] = [
    { id: 'card', Icon: IdCard },
    { id: 'qr', Icon: QrCode },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('label')}
      className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-1"
    >
      {tabs.map(({ id, Icon }) => (
        <button
          key={id}
          id={`editor-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={view === id}
          aria-controls={`editor-panel-${id}`}
          onClick={() => onChange(id)}
          className={cn(
            'inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium outline-none',
            'transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
            view === id ? 'bg-surface-1 text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {t(id)}
        </button>
      ))}
    </div>
  );
}

/**
 * Where the member arranges their card, in a floating window: along the top, the card's colour as
 * three icons and the two sections (the card, and the page its QR opens); below, either the live
 * badge with the stickers they hold, or that page drawn as a visitor sees it, beside the choices
 * of what it shows. Nothing is saved until they press save; reset puts back what was saved.
 * Everything here is also reachable from the keyboard.
 */
export function CardEditor({ card, onClose }: { card: MemberCard; onClose: () => void }) {
  const t = useTranslations('wallet.editor');
  const tName = useTranslations('walletPass.sticker');
  const tHint = useTranslations('walletPass.stickerHint');
  const { update, place, renew } = useCardActions(card.membershipId);

  const roleTone = cardToneFor(card);
  const [view, setView] = useState<View>('card');
  const [tone, setTone] = useState<Tone | null>(card.tonePreference);
  // Where the colour was pressed: the card's new colour spreads from there like a drop of ink.
  const [inkOrigin, setInkOrigin] = useState<{ x: number; y: number } | undefined>();
  const [placements, setPlacements] = useState<StickerPlacement[]>(() => placedOf(card));
  const [selected, setSelected] = useState<StickerKey | null>(null);
  // The card opens on its back, where the stickers are, and can be turned to see the front again.
  const [flipped, setFlipped] = useState(true);
  const [share, setShare] = useState({
    enabled: card.share.enabled,
    showPoints: card.share.showPoints,
    showActivity: card.share.showActivity,
  });
  const [status, setStatus] = useState<'idle' | 'saved' | 'renewed' | 'failed'>('idle');

  const earnedKeys = useMemo(() => new Set(card.stickers.map((sticker) => sticker.key)), [card]);
  const placedKeys = new Set(placements.map((placement) => placement.key));

  const dirty =
    tone !== card.tonePreference ||
    !sameLayout(placements, placedOf(card)) ||
    share.enabled !== card.share.enabled ||
    share.showPoints !== card.share.showPoints ||
    share.showActivity !== card.share.showActivity;

  const change = (key: StickerKey, patch: Partial<StickerPlacement>) =>
    setPlacements((current) =>
      current.map((placement) => (placement.key === key ? { ...placement, ...patch } : placement)),
    );

  const stick = (key: StickerKey) => {
    if (placedKeys.has(key) || placements.length >= MAX_PLACED_STICKERS) return;
    const top = placements.reduce((max, placement) => Math.max(max, placement.z), -1);
    setPlacements((current) => [
      ...current,
      { ...defaultPlacement(key, current.length), z: Math.min(100, top + 1) },
    ]);
    setSelected(key);
  };

  const unstick = (key: StickerKey) => {
    setPlacements((current) => current.filter((placement) => placement.key !== key));
    setSelected((current) => (current === key ? null : current));
  };

  const reset = () => {
    setTone(card.tonePreference);
    setPlacements(placedOf(card));
    setShare({
      enabled: card.share.enabled,
      showPoints: card.share.showPoints,
      showActivity: card.share.showActivity,
    });
    setSelected(null);
    setStatus('idle');
  };

  const saving = update.isPending || place.isPending;
  const save = async () => {
    setStatus('idle');
    try {
      if (!sameLayout(placements, placedOf(card))) await place.mutateAsync(placements);
      const shareChanged =
        share.enabled !== card.share.enabled ||
        share.showPoints !== card.share.showPoints ||
        share.showActivity !== card.share.showActivity;
      if (tone !== card.tonePreference || shareChanged) {
        await update.mutateAsync({
          ...(tone !== card.tonePreference ? { tone } : {}),
          ...(shareChanged ? { share } : {}),
        });
      }
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  };

  const editor: BadgeEditor = {
    placements,
    selected,
    onSelect: setSelected,
    onMove: (key, x, y) => change(key, { x, y }),
    onRemove: unstick,
    onAdjust: (key, patch) => change(key, patch),
    tone: tone ?? roleTone,
    inkOrigin,
  };

  // What a visitor would see: the page as saved supplies the months and the activity (the card
  // does not carry them), and everything the member can change here is read from their live choices.
  const token = tokenOf(card.share.url);
  const saved = useQuery({
    queryKey: ['public-card', token],
    queryFn: ({ signal }) =>
      apiClient.request(publicCardEndpoint, { params: { token: token ?? '' } }, { signal }),
    enabled: token !== null && card.share.enabled && view === 'qr',
    retry: false,
    staleTime: 30_000,
  });
  const preview: PublicCard = {
    fullName: card.fullName,
    club: { name: card.club.name, slug: card.club.slug },
    mood: card.mood,
    tone: tone ?? roleTone,
    role: cardRoleLabel(card, walletPassAr),
    hijriYear: card.hijriYear,
    stampsTotal: card.stampsTotal,
    points: share.showPoints ? card.points : null,
    stampsEarned: share.showPoints ? card.stampsEarned : null,
    thisMonth: share.showPoints ? (saved.data?.thisMonth ?? null) : null,
    monthly: share.showPoints ? (saved.data?.monthly ?? null) : null,
    stickers: card.stickers.map((sticker) => ({
      key: sticker.key,
      placement: placements.find((placement) => placement.key === sticker.key) ?? null,
    })),
    activity: share.showPoints && share.showActivity ? (saved.data?.activity ?? []) : null,
  };

  return (
    <div className="grid gap-5" role="group" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs view={view} onChange={setView} />
        <ToneSwitch
          tone={tone}
          onChange={(next, origin) => {
            setInkOrigin(origin);
            setTone(next);
          }}
        />
      </div>

      <div
        id="editor-panel-card"
        role="tabpanel"
        aria-labelledby="editor-tab-card"
        hidden={view !== 'card'}
        className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[auto_minmax(0,1fr)]"
      >
        <div className="mx-auto w-full max-w-[22.4rem] md:sticky md:top-0">
          <MemberBadge
            card={card}
            editor={editor}
            flipped={flipped}
            onFlippedChange={setFlipped}
            extra={<p className="m-0 text-center text-xs text-fg-muted">{t('hint')}</p>}
          />
        </div>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold">{t('stickers')}</h3>
            <p className="text-sm text-fg-muted">
              {t('stickersHelp', { placed: placements.length, earned: earnedKeys.size })}
            </p>
          </div>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-4 p-0">
            {STICKER_KEYS.map((key) => {
              const earned = earnedKeys.has(key);
              const on = placedKeys.has(key);
              return (
                <li key={key} className="grid justify-items-center gap-1.5 text-center">
                  <button
                    type="button"
                    disabled={!earned}
                    aria-pressed={on}
                    aria-label={
                      earned
                        ? on
                          ? t('unstick', { name: tName(key) })
                          : t('stick', { name: tName(key) })
                        : `${tName(key)} — ${tHint(key)}`
                    }
                    onClick={() => (on ? unstick(key) : stick(key))}
                    className={cn(
                      'rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      earned
                        ? 'cursor-pointer transition-[transform,filter] duration-200 ease-[var(--ease-out)] hover:scale-105 active:scale-90 motion-reduce:transition-none'
                        : 'cursor-not-allowed',
                      on &&
                        earned &&
                        '[filter:drop-shadow(0_0_6px_color-mix(in_oklab,var(--tuwaiq-lilac)_70%,transparent))]',
                    )}
                  >
                    <Sticker stickerKey={key} size={72} locked={!earned} />
                  </button>
                  <span className={cn('text-xs font-semibold', !earned && 'text-fg-muted')}>
                    {tName(key)}
                  </span>
                  <span className="font-mono text-[10px] text-fg-muted">
                    {earned ? (on ? t('onCard') : t('earned')) : tHint(key)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div
        id="editor-panel-qr"
        role="tabpanel"
        aria-labelledby="editor-tab-qr"
        hidden={view !== 'qr'}
        className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]"
      >
        {/* First, so it sits on the right of a right-to-left window: the page, drawn in full. */}
        <div className="grid min-w-0 gap-2">
          <p className="m-0 text-xs text-fg-muted">{t('preview.live')}</p>
          {share.enabled ? (
            <PublicCardView card={preview} />
          ) : (
            <EmptyState icon={Lock} title={t('preview.off')} description={t('preview.offBody')} />
          )}
        </div>
        <div className="grid content-start gap-3 lg:sticky lg:top-0">
          <h3 className="text-sm font-semibold">{t('share.title')}</h3>
          {(
            [
              ['enabled', 'enabled'],
              ['showPoints', 'showPoints'],
              ['showActivity', 'showActivity'],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="flex items-center justify-between gap-4 text-sm">
              <span>{t(`share.${label}`)}</span>
              <Switch
                checked={share[field] && (field === 'enabled' || share.enabled)}
                disabled={
                  field !== 'enabled' &&
                  (!share.enabled || (field === 'showActivity' && !share.showPoints))
                }
                onCheckedChange={(checked) =>
                  setShare((current) => ({ ...current, [field]: checked }))
                }
              />
            </label>
          ))}
          <div className="grid gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={renew.isPending}
              onClick={() =>
                renew.mutate(undefined, {
                  onSuccess: () => setStatus('renewed'),
                  onError: () => setStatus('failed'),
                })
              }
            >
              {t('share.renew')}
            </Button>
            <span className="text-xs text-fg-muted">{t('share.renewHelp')}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
          {t('reset')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        <p role="status" className="text-sm text-fg-muted">
          {status === 'saved' ? t('saved') : status === 'renewed' ? t('share.renewed') : null}
        </p>
        {status === 'failed' ? (
          <p role="alert" className="text-sm text-danger">
            {t('failed')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
