'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { cn } from '@/client/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { MemberCard } from '@/shared/contracts/wallet';
import { cardToneFor } from '@/shared/lib/member-card';
import {
  defaultPlacement,
  MAX_PLACED_STICKERS,
  PLACEMENT_LIMITS,
  STICKER_KEYS,
  type StickerKey,
  type StickerPlacement,
} from '@/shared/lib/stickers';

import { MemberBadge, type BadgeEditor } from './member-badge';
import { Sticker } from './sticker';
import { useCardActions } from '../hooks/use-card-actions';

type Tone = 'paper' | 'matte';

const placedOf = (card: MemberCard): StickerPlacement[] =>
  card.stickers.flatMap((sticker) => sticker.placement ?? []);

const sameLayout = (a: readonly StickerPlacement[], b: readonly StickerPlacement[]) =>
  JSON.stringify([...a].sort((x, y) => x.key.localeCompare(y.key))) ===
  JSON.stringify([...b].sort((x, y) => x.key.localeCompare(y.key)));

/**
 * Where the member arranges their card: a live badge on one side (the back, with the stickers
 * they can pick up and move), and on the other the stickers they hold, the ones still to earn, the
 * card's colour, and what their QR page shows. Nothing is saved until they press save; reset puts
 * back what was saved. Everything here is also reachable from the keyboard.
 */
export function CardEditor({ card, onClose }: { card: MemberCard; onClose: () => void }) {
  const t = useTranslations('wallet.editor');
  const tName = useTranslations('walletPass.sticker');
  const tHint = useTranslations('walletPass.stickerHint');
  const { update, place, renew } = useCardActions(card.membershipId);

  const roleTone = cardToneFor(card);
  const [tone, setTone] = useState<Tone | null>(card.tonePreference);
  const [placements, setPlacements] = useState<StickerPlacement[]>(() => placedOf(card));
  const [selected, setSelected] = useState<StickerKey | null>(null);
  const [share, setShare] = useState({
    enabled: card.share.enabled,
    showPoints: card.share.showPoints,
    showActivity: card.share.showActivity,
  });
  const [status, setStatus] = useState<'idle' | 'saved' | 'renewed' | 'failed'>('idle');

  const earnedKeys = useMemo(() => new Set(card.stickers.map((sticker) => sticker.key)), [card]);
  const placedKeys = new Set(placements.map((placement) => placement.key));
  const picked = placements.find((placement) => placement.key === selected) ?? null;

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
    tone: tone ?? roleTone,
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
      <MemberBadge card={card} editor={editor} flipped />
      <div
        className="grid gap-5 rounded-card border border-border bg-surface-1 p-5"
        aria-label={t('title')}
        role="group"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold">{t('stickers')}</h3>
            <p className="text-sm text-fg-muted">
              {t('stickersHelp', { placed: placements.length, earned: earnedKeys.size })}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('close')}
          </Button>
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
                      ? 'cursor-pointer transition-transform hover:scale-105'
                      : 'cursor-not-allowed',
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

        <fieldset className="grid gap-3 border-t border-border pt-4" disabled={!picked}>
          <legend className="text-sm font-semibold">{t('selected')}</legend>
          {picked ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                {t('rotate')}
                <input
                  type="range"
                  min={PLACEMENT_LIMITS.rotation.min}
                  max={PLACEMENT_LIMITS.rotation.max}
                  step={1}
                  value={picked.rotation}
                  onChange={(event) => change(picked.key, { rotation: Number(event.target.value) })}
                  className="accent-primary"
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('size')}
                <input
                  type="range"
                  min={PLACEMENT_LIMITS.scale.min}
                  max={PLACEMENT_LIMITS.scale.max}
                  step={0.05}
                  value={picked.scale}
                  onChange={(event) => change(picked.key, { scale: Number(event.target.value) })}
                  className="accent-primary"
                />
              </label>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t('none')}</p>
          )}
        </fieldset>

        <div className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t('tone.title')}</h3>
          <div role="group" aria-label={t('tone.title')} className="flex flex-wrap gap-2">
            {(
              [
                ['role', null],
                ['paper', 'paper'],
                ['matte', 'matte'],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                type="button"
                aria-pressed={tone === value}
                onClick={() => setTone(value)}
                className={cn(
                  'rounded-control border px-4 py-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  tone === value
                    ? 'border-primary bg-primary-subtle text-primary-subtle-fg'
                    : 'border-border-strong hover:bg-surface-2',
                )}
              >
                {t(`tone.${label}`)}
              </button>
            ))}
          </div>
          <p className="text-sm text-fg-muted">{t('tone.help')}</p>
        </div>

        <div className="grid gap-3 border-t border-border pt-4">
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
          <div className="flex flex-wrap items-center gap-3">
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

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
            {saving ? t('saving') : t('save')}
          </Button>
          <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
            {t('reset')}
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
    </div>
  );
}
