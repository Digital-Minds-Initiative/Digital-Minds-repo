'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { AlbumEntry } from '@/shared/contracts/stickers';
import type { MemberCard } from '@/shared/contracts/wallet';

import { Sticker } from './sticker';
import { StickerDetail, type StickerFacts } from './sticker-detail';
import { useAlbum } from '../hooks/use-custom-stickers';
import { StickerDefsContext, useStickerText } from '../hooks/use-sticker-text';

type Filter = 'all' | 'mine' | 'missing' | 'legendary' | 'seasonal';
const FILTERS: readonly Filter[] = ['all', 'mine', 'missing', 'legendary', 'seasonal'];

const RARITY_VARIANT = { COMMON: 'neutral', RARE: 'info', LEGENDARY: 'warning' } as const;

const matches = (entry: AlbumEntry, filter: Filter): boolean => {
  switch (filter) {
    case 'mine':
      return entry.held;
    case 'missing':
      return !entry.held;
    case 'legendary':
      return entry.rarity === 'LEGENDARY';
    case 'seasonal':
      return entry.availableFrom !== null || entry.availableUntil !== null;
    default:
      return true;
  }
};

/** A sticker nobody has told you about yet: a quiet «؟» that stays until someone gives you the real one. */
function SecretTile() {
  const t = useTranslations('wallet.album');
  return (
    <li className="grid justify-items-center gap-2 text-center text-sm">
      <svg
        role="img"
        aria-label={t('secret')}
        viewBox="0 0 100 100"
        width={88}
        height={88}
        className="block"
      >
        <circle
          cx="50"
          cy="50"
          r="49.5"
          fill="var(--badge-white)"
          stroke="color-mix(in oklab, var(--badge-ink) 28%, transparent)"
        />
        <circle cx="50" cy="50" r="44" fill="var(--deep)" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--badge-gold)"
          strokeOpacity="0.4"
          strokeDasharray="2.2 3"
        />
        <text
          x="50"
          y="64"
          textAnchor="middle"
          fontSize="44"
          fontWeight="700"
          fill="var(--badge-gold)"
        >
          ؟
        </text>
      </svg>
      <span className="text-fg-muted">{t('secret')}</span>
      <Badge variant="neutral">{t('rarity.secret')}</Badge>
    </li>
  );
}

/**
 * «ألبوم الملصقات» (docs/adr/0034-album-claims-and-seasons.md): every sticker the club has, the ones
 * the member holds in colour and the rest grey, each with its rarity and the share of the club that
 * holds it. Hidden stickers they do not hold show as «؟». Pressing one opens its page.
 */
export function StickerAlbum({ card }: { card: MemberCard }) {
  const t = useTranslations('wallet.album');
  const text = useStickerText();
  const album = useAlbum(card.membershipId);
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<StickerFacts | null>(null);

  const defs = useMemo(
    () =>
      new Map(
        (album.data?.entries ?? []).flatMap((entry) =>
          entry.custom ? [[entry.key as string, entry.custom] as const] : [],
        ),
      ),
    [album.data],
  );

  if (album.isPending) return <Skeleton className="h-64" />;
  if (album.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {t('failed')}
      </p>
    );
  }

  const { entries, secretCount } = album.data;
  const held = entries.filter((entry) => entry.held).length;
  const total = entries.length + secretCount;
  const shown = entries.filter((entry) => matches(entry, filter));

  const open = (entry: AlbumEntry) => {
    const mine = card.stickers.find((sticker) => sticker.key === entry.key);
    setDetail({
      key: entry.key,
      custom: entry.custom,
      held: entry.held,
      source: mine?.source ?? null,
      earnedAt: mine?.earnedAt ?? null,
      reason: mine?.reason ?? null,
      album: {
        rarity: entry.rarity,
        heldPercent: entry.heldPercent,
        availableFrom: entry.availableFrom,
        availableUntil: entry.availableUntil,
        open: entry.open,
      },
    });
  };

  return (
    <StickerDefsContext.Provider value={defs}>
      <section
        aria-labelledby={`album-${card.membershipId}`}
        className="grid gap-5 rounded-card border border-border bg-surface-1 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`album-${card.membershipId}`} className="m-0 text-base font-semibold">
            {t('title', { club: card.club.name })}
          </h2>
          <span className="font-mono text-sm text-fg-muted" dir="ltr">
            {held} / {total}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={held}
          aria-label={t('progress')}
          className="h-3 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full rounded-full bg-gradient-to-l from-primary to-success"
            style={{ width: `${total === 0 ? 0 : (held / total) * 100}%` }}
          />
        </div>
        <div role="group" aria-label={t('filters.label')} className="flex flex-wrap gap-2">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                filter === value
                  ? 'border-primary bg-primary font-semibold text-primary-fg'
                  : 'border-border bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {t(`filters.${value}`)}
            </button>
          ))}
        </div>
        <ul
          aria-label={t('listLabel')}
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(7rem,100%),1fr))] gap-x-3 gap-y-6 p-0"
        >
          {shown.map((entry) => {
            const name = text.name(entry.key, entry.custom);
            return (
              <li key={entry.key} className="grid justify-items-center gap-2 text-center text-sm">
                <button
                  type="button"
                  onClick={() => open(entry)}
                  aria-label={t('open', { name })}
                  className="cursor-pointer rounded-full transition-transform duration-200 outline-none hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 motion-reduce:transition-none"
                >
                  <Sticker
                    stickerKey={entry.key}
                    custom={entry.custom}
                    size={88}
                    locked={!entry.held}
                  />
                </button>
                <span className={cn('font-medium', !entry.held && 'text-fg-muted')}>{name}</span>
                <Badge variant={RARITY_VARIANT[entry.rarity]}>{t(`rarity.${entry.rarity}`)}</Badge>
                {entry.heldPercent !== null ? (
                  <span className="text-xs text-fg-muted">
                    {t('heldBy', { percent: entry.heldPercent })}
                  </span>
                ) : null}
                {!entry.open && !entry.held ? (
                  <span className="text-xs text-warning">{t('closed')}</span>
                ) : null}
              </li>
            );
          })}
          {filter === 'all' || filter === 'missing'
            ? Array.from({ length: secretCount }, (_, index) => (
                <SecretTile key={`secret-${index}`} />
              ))
            : null}
        </ul>
        {shown.length === 0 && !(filter === 'all' || filter === 'missing') ? (
          <p className="m-0 text-sm text-fg-muted">{t('nothing')}</p>
        ) : null}
        <StickerDetail facts={detail} viewer="owner" onClose={() => setDetail(null)} />
      </section>
    </StickerDefsContext.Provider>
  );
}
