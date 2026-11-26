'use client';

import { QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns/empty-state';
import type { MemberCard } from '@/shared/contracts/wallet';

import { PublicCardPage } from './public-card-page';

/** The token the QR's address ends with: `/c/<token>`. */
function tokenOf(url: string): string | null {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

/**
 * «صفحة الـQR»: the page whoever scans a member's code lands on, shown here on the dashboard exactly
 * as they see it, one for each club's card. It is the real page (the same component and the same
 * public request), so a change made in the card editor shows here as soon as it is saved, and when
 * the member switches the page off they see that it is off instead of an empty frame.
 */
export function QrPageSection({ cards }: { cards: readonly MemberCard[] }) {
  const t = useTranslations('wallet.qrPage');
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="qr-page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="qr-page-title" className="text-base font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-fg-muted">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22.4rem),1fr))] items-start gap-x-8 gap-y-12">
        {cards.map((card) => {
          const token = card.share.enabled && card.share.url ? tokenOf(card.share.url) : null;
          return (
            <div key={card.membershipId} className="grid w-full justify-items-center gap-3">
              <h3 className="m-0 text-sm font-semibold text-fg-muted">
                {t('forClub', { club: card.club.name })}
              </h3>
              {token ? (
                <div className="w-full rounded-card border border-border bg-surface-1 p-3">
                  <PublicCardPage token={token} />
                </div>
              ) : (
                <EmptyState icon={QrCode} title={t('off')} description={t('offHint')} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
