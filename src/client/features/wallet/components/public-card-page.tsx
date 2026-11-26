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

import { FitFigure } from './fit-figure';
import { PanelArt } from './panel-art';
import { Sticker } from './sticker';
import { useCountUp, useSeenOnce } from '../hooks/use-badge-motion';
import { badgeThemeFor } from '../lib/badge-theme';
import { formatFigure } from '../lib/number-fit';

const MONTH_CELLS = 8;
/** Points a month it takes to fill every cell of the chart: a bar is relative to the best month shown. */
const MIN_FULL_SCALE = 40;

/** The last months of points as columns of cells, like the system's other counters. */
function MonthChart({
  monthly,
  ink,
  seen,
}: {
  monthly: NonNullable<PublicCard['monthly']>;
  ink: string;
  /** The page has come into view: the columns fill in, one after the other. */
  seen: boolean;
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
                  className={cn(
                    'block size-[11px] rounded-[2px]',
                    seen
                      ? 'motion-safe:animate-[chart-cell_420ms_var(--ease-out)_backwards]'
                      : 'motion-safe:opacity-0',
                  )}
                  style={{
                    ...(cell < filled
                      ? { background: ink, opacity: last ? 1 : 0.55 }
                      : { boxShadow: `inset 0 0 0 1px ${ink}`, opacity: 0.2 }),
                    // Each column rises from its floor, a little after the one before it.
                    animationDelay: `${index * 70 + cell * 22}ms`,
                  }}
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
  const { data, isPending, error } = useQuery({
    queryKey: ['public-card', token],
    queryFn: ({ signal }) =>
      apiClient.request(publicCardEndpoint, { params: { token } }, { signal }),
    retry: false,
  });

  if (isPending) {
    return (
      <div className="mx-auto grid w-full max-w-[440px] gap-4 p-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[236px]" />
      </div>
    );
  }
  if (error) {
    const busy = error instanceof ApiError && error.status === 429;
    return (
      <div className="mx-auto w-full max-w-[440px] p-5">
        <EmptyState
          icon={Lock}
          title={busy ? t('busy.title') : t('unavailable.title')}
          description={busy ? t('busy.body') : t('unavailable.body')}
        />
      </div>
    );
  }

  return <PublicCardView card={data} />;
}

/**
 * The page itself, drawn from what it is given. It answers to the room it is in, not to the
 * screen: narrow, it is one column like a phone; from about 36rem of room it lays out in two, the
 * member and their points beside their stickers and activity, so it reads on a computer as well.
 * The card editor draws the same view from the member's unsaved choices, as a live preview.
 */
export function PublicCardView({ card }: { card: PublicCard }) {
  const t = useTranslations('wallet.public');
  const tSticker = useTranslations('walletPass.sticker');
  const [pageRef, seen] = useSeenOnce<HTMLElement>();
  const theme = badgeThemeFor({ mood: card.mood, tone: card.tone });
  const points = useCountUp(card.points ?? 0, seen, 1100);
  const month = useCountUp(Math.abs(card.thisMonth ?? 0), seen, 900);

  return (
    <div className="@container w-full">
      <div className="mx-auto w-full max-w-[440px] @xl:max-w-4xl">
        <article
          ref={pageRef}
          aria-label={card.fullName}
          className="my-6 grid gap-5 overflow-hidden rounded-[16px] p-5 @xl:p-8"
          style={{
            background: theme.ground,
            color: theme.text,
            boxShadow: `inset 0 0 0 1px ${theme.ring}`,
            transition: 'background-color 500ms ease, color 500ms ease',
          }}
        >
          <div className="grid items-start gap-5 @xl:grid-cols-2 @xl:gap-8">
            <div className="grid content-start gap-5">
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
                  className="m-0 max-w-full text-[30px] leading-[1.3] font-medium text-balance [overflow-wrap:anywhere]"
                  style={{ fontSize: card.fullName.length > 24 ? 24 : 30 }}
                >
                  <span aria-hidden>{withKashida(card.fullName)}</span>
                </h1>
                <p className="m-0 text-xl font-semibold" style={{ color: theme.accent }}>
                  {card.role}
                </p>
              </header>

              {card.points !== null ? (
                <section
                  aria-label={t('points')}
                  className="relative grid min-h-[236px] overflow-hidden rounded-[10px] p-5"
                  style={{ background: theme.panelBase, color: theme.panelText }}
                >
                  <PanelArt theme={theme} />
                  <div className="relative flex items-start justify-between gap-4">
                    {card.monthly !== null ? (
                      <MonthChart monthly={card.monthly} ink={theme.panelText} seen={seen} />
                    ) : (
                      <span />
                    )}
                    <div className="grid min-w-0 flex-1 justify-items-end">
                      <span className="text-xs font-semibold opacity-90">{t('points')}</span>
                      <FitFigure
                        shown={formatFigure(points)}
                        final={formatFigure(card.points)}
                        base={56}
                      />
                      {card.thisMonth !== null ? (
                        <span className="mt-1 text-sm opacity-90">
                          {t('thisMonth')}{' '}
                          <b className="font-mono whitespace-nowrap" dir="ltr">
                            {card.thisMonth >= 0 ? '+' : '−'}
                            {formatFigure(month)}
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
            </div>

            <div className="grid content-start gap-5">
              {card.stickers.length > 0 ? (
                <section aria-label={t('stickers')} className="grid gap-3">
                  <div className="flex items-baseline justify-between">
                    <h2 className="m-0 text-base font-bold">{t('stickers')}</h2>
                    <span
                      className="font-mono text-[10px]"
                      dir="ltr"
                      style={{ color: theme.textMuted }}
                    >
                      {card.stickers.length}
                    </span>
                  </div>
                  <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                    {card.stickers.map((sticker, index) => (
                      <li
                        key={sticker.key}
                        title={tSticker(sticker.key)}
                        className="motion-safe:animate-[sticker-stick_480ms_var(--ease-out)_backwards]"
                        style={{ animationDelay: `${index * 80}ms` }}
                      >
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
                        className="flex items-center gap-3 border-t py-2.5 motion-safe:animate-[word-in_360ms_var(--ease-out)_backwards]"
                        style={{ borderColor: theme.ring, animationDelay: `${index * 70}ms` }}
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
                          className="font-mono text-sm font-semibold whitespace-nowrap"
                          dir="ltr"
                          style={{ color: row.amount < 0 ? 'var(--color-danger)' : theme.accent }}
                        >
                          {row.amount < 0 ? '−' : '+'}
                          {formatFigure(Math.abs(row.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>

          <p className="m-0 text-center text-xs leading-6" style={{ color: theme.textMuted }}>
            {t('footer')}
          </p>
        </article>
      </div>
    </div>
  );
}
