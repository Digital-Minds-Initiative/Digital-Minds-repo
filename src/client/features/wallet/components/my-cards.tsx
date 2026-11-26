'use client';

import { IdCard, Palette } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { MemberCard } from '@/shared/contracts/wallet';

import { CardEditor } from './card-editor';
import { MemberBadge } from './member-badge';
import { QrPageSection } from './qr-page-section';
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
    <div className="grid gap-10">
      <section aria-labelledby="my-cards-title" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="my-cards-title" className="text-base font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-fg-muted">{t('subtitle')}</p>
        </div>
        {/* Cards sit side by side whenever two fit, all on one top line. */}
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,22.4rem),1fr))] items-start gap-x-8 gap-y-12 p-0">
          {data.cards.map((card) => (
            <li
              key={card.membershipId}
              aria-label={t('cardFor', { club: card.club.name })}
              className="grid w-full justify-items-center"
            >
              <CardWorkspace card={card} />
            </li>
          ))}
        </ul>
      </section>
      <QrPageSection cards={data.cards} />
    </div>
  );
}

/**
 * One card: the badge and the wallet buttons. «تخصيص البطاقة» opens the editor in its own floating
 * window over a blurred dashboard, so the page behind never moves and the editor has the room it
 * needs for a live card, its stickers and its settings side by side.
 */
function CardWorkspace({ card }: { card: MemberCard }) {
  const t = useTranslations('wallet.editor');
  const [editing, setEditing] = useState(false);

  return (
    <div className="w-full max-w-[22.4rem]">
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
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          hideCloseButton
          overlayClassName="backdrop-blur-md"
          className="top-[4vh] max-h-[92vh] max-w-5xl translate-y-0 grid-cols-[minmax(0,1fr)] content-start overflow-y-auto p-5 sm:p-6"
        >
          <DialogHeader className="pe-0">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <CardEditor card={card} onClose={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
