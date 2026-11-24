'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { ApiError, apiClient } from '@/client/lib/api-client';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { MARK_MASK_STYLE } from '@/components/shell/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { publicCardEndpoint, type PublicCard } from '@/shared/contracts/cards';
import { withKashida } from '@/shared/lib/member-card';

import { PanelArt } from './panel-art';
import { Sticker } from './sticker';
import { badgeThemeFor } from '../lib/badge-theme';

const MONTH_CELLS = 8;
/** Points a month it takes to fill every cell of the chart: a bar is relative to the best month shown. */
const MIN_FULL_SCALE = 40;

/** The last months of points as columns of cells, like the system's other counters. */
function MonthChart({
  monthly,
  ink,
}: {
  monthly: NonNullable<PublicCard['monthly']>;
  ink: string;
}) {
  const format = useFormatter();
  const best = Math.max(MIN_FULL_SCALE, ...monthly.map((entry) => Math.max(0, entry.points)));
  return (
    <div
      className="flex items-end gap-1.5"
      dir="ltr"
      role="img"
      aria-label={monthly.map((e) => `${e.month}: ${e.points}`).join(', ')}
    >
      {monthly.map((entry, index) => {
        const filled = Math.round((Math.max(0, entry.points) / best) * MONTH_CELLS);
        const last = index === monthly.length - 1;
        const [year, month] = entry.month.split('-').map(Number) as [number, number];
        return (
          <div key={entry.month} className="grid justify-items-center gap-1">
            <div className="flex flex-col-reverse gap-[3px]">
              {Array.from({ length: MONTH_CELLS }, (_, cell) => (
                <span
                  key={cell}
                  className="block size-[11px] rounded-[2px]"
                  style={
                    cell < filled
                      ? { background: ink, opacity: last ? 1 : 0.55 }
                      : { boxShadow: `inset 0 0 0 1px ${ink}`, opacity: 0.2 }
                  }
                />
              ))}
            </div>
            <span className="font-mono text-[8px] uppercase opacity-70" style={{ color: ink }}>
              {format.dateTime(new Date(Date.UTC(year, month - 1, 1)), {
                month: 'short',
                timeZone: 'UTC',
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The page a member's QR opens (docs/adr/0032-card-link-and-stickers.md): who they are, how many
 * points they have and how the months went, the stickers they earned, and — only if they turned it
 * on — what their latest points were for. It dresses itself like the member's badge, white or
 * matte, and shows nothing the member did not allow: when they keep their points private, the panel
 * is simply not there. Every way a link can be dead — unknown, renewed, switched off — reads the same.
 */
export function PublicCardPage({ token }: { token: string }) {
  const t = useTranslations('wallet.public');
  const tSticker = useTranslations('walletPass.sticker');
  const format = useFormatter();
  const { data, isPending, error } = useQuery({
    queryKey: ['public-card', token],
    queryFn: ({ signal }) =>
      apiClient.request(publicCardEndpoint, { params: { token } }, { signal }),
    retry: false,
  });

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-[440px] gap-4 p-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[236px]" />
      </div>
    );
  }
  if (error) {
    const busy = error instanceof ApiError && error.status === 429;
    return (
      <div className="mx-auto max-w-[440px] p-5">
        <EmptyState
          icon={Lock}
          title={busy ? t('busy.title') : t('unavailable.title')}
          description={busy ? t('busy.body') : t('unavailable.body')}
        />
      </div>
    );
  }

  const card = data;
  const theme = badgeThemeFor({ mood: card.mood, tone: card.tone });

  return (
    <article
      aria-label={card.fullName}
      className="mx-auto my-6 grid max-w-[440px] gap-5 overflow-hidden rounded-[16px] p-5"
      style={{
        background: theme.ground,
        color: theme.text,
        boxShadow: `inset 0 0 0 1px ${theme.ring}`,
      }}
    >
      <div className="flex items-center gap-3" dir="ltr">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="block h-7 w-auto"
            style={{ ...MARK_MASK_STYLE, background: theme.mark }}
          />
          <span className="font-mono text-sm font-medium">Digital Minds</span>
        </span>
      </div>

      <header className="grid gap-1.5">
        <p
          className="m-0 font-mono text-[10px] tracking-[0.06em] uppercase"
          dir="ltr"
          style={{ color: theme.textMuted, textAlign: 'end' }}
        >
          {card.club.name} · {card.hijriYear}
        </p>
        <h1
          aria-label={card.fullName}
          className="m-0 max-w-full overflow-hidden text-[30px] leading-[1.3] font-medium text-ellipsis whitespace-nowrap"
          style={{ fontSize: card.fullName.length > 24 ? 24 : 30 }}
        >
          <span aria-hidden>{withKashida(card.fullName)}</span>
        </h1>
        <p className="m-0 text-xl font-semibold" style={{ color: theme.accent }}>
          {card.role}
        </p>
      </header>

      {card.points !== null && card.monthly !== null ? (
        <section
          aria-label={t('points')}
          className="relative grid min-h-[236px] overflow-hidden rounded-[10px] p-5"
          style={{ background: theme.panelBase, color: theme.panelText }}
        >
          <PanelArt theme={theme} />
          <div className="relative flex items-start justify-between gap-4">
            <MonthChart monthly={card.monthly} ink={theme.panelText} />
            <div className="grid justify-items-end">
              <span className="text-xs font-semibold opacity-90">{t('points')}</span>
              <span
                className="font-mono text-[56px] leading-none font-medium [font-variant-numeric:lining-nums_tabular-nums]"
                dir="ltr"
              >
                {format.number(card.points)}
              </span>
              {card.thisMonth !== null ? (
                <span className="mt-1 text-sm opacity-90">
                  {t('thisMonth')}{' '}
                  <b className="font-mono" dir="ltr">
                    {card.thisMonth >= 0 ? '+' : '−'}
                    {Math.abs(card.thisMonth)}
                  </b>
                </span>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <p
          className="m-0 rounded-[10px] px-4 py-3 text-sm"
          style={{ boxShadow: `inset 0 0 0 1px ${theme.ring}`, color: theme.textMuted }}
        >
          {t('pointsPrivate')}
        </p>
      )}

      {card.stickers.length > 0 ? (
        <section aria-label={t('stickers')} className="grid gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-base font-bold">{t('stickers')}</h2>
            <span className="font-mono text-[10px]" dir="ltr" style={{ color: theme.textMuted }}>
              {card.stickers.length}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {card.stickers.map((sticker, index) => (
              <li key={sticker.key} title={tSticker(sticker.key)}>
                <Sticker
                  stickerKey={sticker.key}
                  size={60}
                  className={cn(index % 2 === 0 ? '-rotate-6' : 'rotate-5')}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {card.activity !== null && card.activity.length > 0 ? (
        <section aria-label={t('activity')} className="grid gap-1">
          <h2 className="m-0 mb-1 text-base font-bold">{t('activity')}</h2>
          <ul className="m-0 grid list-none p-0">
            {card.activity.map((row, index) => (
              <li
                key={`${row.workDate}-${index}`}
                className="flex items-center gap-3 border-t py-2.5"
                style={{ borderColor: theme.ring }}
              >
                <span
                  className="w-[5.6rem] shrink-0 font-mono text-[10px]"
                  dir="ltr"
                  style={{ color: theme.textMuted }}
                >
                  {row.workDate}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium">{row.reason}</span>
                <span
                  className="font-mono text-sm font-semibold"
                  dir="ltr"
                  style={{ color: row.amount < 0 ? 'var(--color-danger)' : theme.accent }}
                >
                  {row.amount < 0 ? '−' : '+'}
                  {Math.abs(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="m-0 text-center text-xs leading-6" style={{ color: theme.textMuted }}>
        {t('footer')}
      </p>
    </article>
  );
}
