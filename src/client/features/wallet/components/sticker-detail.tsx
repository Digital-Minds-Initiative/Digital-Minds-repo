'use client';

import { CalendarDays, HelpCircle, Lock, Sparkles, TextQuote } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  isCustomStickerKey,
  STICKER_RULES,
  type CustomStickerDef,
  type StickerKey,
  type StickerRef,
} from '@/shared/lib/stickers';

import { Sticker } from './sticker';
import { useStickerText } from '../hooks/use-sticker-text';

/** Everything the page knows about one sticker: what it is, whether it is held, and how. */
export interface StickerFacts {
  key: StickerRef;
  custom: CustomStickerDef | null;
  /** Held by the person whose card this is. False for one still to earn, shown locked. */
  held: boolean;
  source: 'role' | 'points' | 'activity' | 'awarded' | null;
  /** When it was given: only an awarded sticker has a single moment. */
  earnedAt: string | null;
  /** What it was given for, when the giver wrote it down and the owner lets it be seen. */
  reason: string | null;
}

/** A small titled fact in the side of the sticker's page. */
function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      <span aria-hidden className="mt-0.5 text-fg-muted [&>svg]:size-4">
        {icon}
      </span>
      <h3 className="m-0 text-xs font-semibold text-fg-muted">{title}</h3>
      <span />
      <div className="text-sm leading-7">{children}</div>
    </div>
  );
}

/**
 * One sticker's page, opened by pressing it: the sticker itself, big, drifting and tilting as if
 * it was floating, and beside it how it is got, how this person got it, when and for what. A
 * hidden sticker says only that it is a secret until someone holds it. `viewer` decides the
 * wording: «حصلت» for the owner on their own card, a neutral one for whoever scanned the QR.
 */
export function StickerDetail({
  facts,
  viewer,
  onClose,
}: {
  facts: StickerFacts | null;
  viewer: 'owner' | 'visitor';
  onClose: () => void;
}) {
  const t = useTranslations('wallet.detail');
  const text = useStickerText();
  const format = useFormatter();

  const builtinKey: StickerKey | null = facts && !isCustomStickerKey(facts.key) ? facts.key : null;
  const secret = Boolean(
    facts &&
    !facts.held &&
    (facts.custom?.hidden || (builtinKey && STICKER_RULES[builtinKey].hidden)),
  );

  return (
    <Dialog open={facts !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName="backdrop-blur-sm"
        className="max-w-2xl grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[13rem_minmax(0,1fr)]"
      >
        {facts ? (
          <>
            <div className="grid place-items-center rounded-card bg-surface-2 p-6">
              {/* Drifts and tilts on a slow loop; still under reduced motion. */}
              <div className="motion-safe:animate-[sticker-float_5s_ease-in-out_infinite]">
                <Sticker
                  stickerKey={facts.key}
                  custom={facts.custom}
                  size={160}
                  locked={!facts.held}
                  peel={facts.key === 'lead'}
                  className="[filter:drop-shadow(0_14px_10px_color-mix(in_oklab,black_28%,transparent))]"
                />
              </div>
            </div>

            <div className="grid content-start gap-4">
              <DialogHeader className="pe-6">
                <DialogTitle>
                  {secret ? t('secretName') : text.name(facts.key, facts.custom)}
                </DialogTitle>
                <DialogDescription>
                  {facts.held
                    ? viewer === 'owner'
                      ? t('heldOwner')
                      : t('heldVisitor')
                    : t('notHeld')}
                </DialogDescription>
              </DialogHeader>

              <Fact icon={<HelpCircle />} title={t('howToGet')}>
                {secret ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Lock aria-hidden className="size-4" />
                    {t('secret')}
                  </span>
                ) : (
                  text.howTo(facts.key, facts.custom)
                )}
              </Fact>

              {facts.held ? (
                <Fact
                  icon={<Sparkles />}
                  title={viewer === 'owner' ? t('howGotOwner') : t('howGotVisitor')}
                >
                  {facts.source ? t(`source.${facts.source}`) : t('source.awarded')}
                </Fact>
              ) : null}

              {facts.held ? (
                <Fact icon={<CalendarDays />} title={t('when')}>
                  {facts.earnedAt ? (
                    <time dateTime={facts.earnedAt}>
                      {format.dateTime(new Date(facts.earnedAt), {
                        dateStyle: 'long',
                        timeZone: 'Asia/Riyadh',
                      })}
                    </time>
                  ) : (
                    t('whenRule')
                  )}
                </Fact>
              ) : null}

              {facts.held && facts.reason ? (
                <Fact icon={<TextQuote />} title={t('reason')}>
                  {facts.reason}
                </Fact>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
