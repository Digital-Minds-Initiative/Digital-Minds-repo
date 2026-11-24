'use client';

import { IdCard, Palette } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { MemberCard } from '@/shared/contracts/wallet';

import { CardEditor } from './card-editor';
import { MemberBadge } from './member-badge';
import { WalletActions } from './wallet-actions';
import { useMyCards } from '../hooks/use-my-cards';

/**
 * «بطاقتك الرقمية»: every member sees their own card for each club they belong to, the way it
 * will sit in Apple Wallet, and can add it from here. Only the caller's own memberships come back
 * from `/me/cards`, so this is safe on every dashboard home, managers' included.
 */
export function MyCards() {
  const t = useTranslations('wallet');
  const { data, isPending, isError } = useMyCards();

  if (isPending) {
    return (
      <section aria-busy aria-label={t('states.loading')} className="grid gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-[448px] max-w-[358px]" />
      </section>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={IdCard}
        title={t('states.error.title')}
        description={t('states.error.body')}
      />
    );
  }
  if (data.cards.length === 0) return null;

  return (
    <section aria-labelledby="my-cards-title" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="my-cards-title" className="text-base font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-fg-muted">{t('subtitle')}</p>
      </div>
      <ul className="m-0 grid list-none gap-10 p-0">
        {data.cards.map((card) => (
          <li
            key={card.membershipId}
            aria-label={t('cardFor', { club: card.club.name })}
            className="w-full"
          >
            <CardWorkspace card={card} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One card: the badge and the wallet buttons, or — once the member asks to customise — the editor. */
function CardWorkspace({ card }: { card: MemberCard }) {
  const t = useTranslations('wallet.editor');
  const [editing, setEditing] = useState(false);

  if (editing) return <CardEditor card={card} onClose={() => setEditing(false)} />;
  return (
    <div className="mx-auto w-full max-w-[22.4rem]">
      <MemberBadge
        card={card}
        extra={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Palette aria-hidden />
              {t('open')}
            </Button>
            <WalletActions card={card} />
          </>
        }
      />
    </div>
  );
}
