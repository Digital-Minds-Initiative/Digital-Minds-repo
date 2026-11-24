'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { apiClient } from '@/client/lib/api-client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  awardStickerEndpoint,
  listMemberStickersEndpoint,
  revokeStickerEndpoint,
} from '@/shared/contracts/cards';
import type { StickerKey } from '@/shared/lib/stickers';

import { Sticker } from './sticker';

/**
 * In a member's file: the stickers they were awarded, and the ones the person looking may give
 * them. The server decides both lists from the viewer's standing (an officer may give any, a lead
 * all but the founder sticker, nobody their own), so this only shows what it is told.
 */
export function MemberStickersSection({ memberId }: { memberId: string }) {
  const t = useTranslations('wallet.award');
  const tName = useTranslations('walletPass.sticker');
  const queryClient = useQueryClient();
  const queryKey = ['member-stickers', memberId] as const;

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.request(listMemberStickersEndpoint, { params: { memberId } }, { signal }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const give = useMutation({
    mutationFn: (key: Extract<StickerKey, 'star' | 'hack' | 'founder' | 'workshop' | 'kind'>) =>
      apiClient.request(awardStickerEndpoint, { params: { memberId }, body: { key } }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (key: Extract<StickerKey, 'star' | 'hack' | 'founder' | 'workshop' | 'kind'>) =>
      apiClient.request(revokeStickerEndpoint, { params: { memberId, key } }),
    onSuccess: refresh,
  });

  return (
    <section aria-label={t('title')} className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Award className="size-4 text-primary" aria-hidden />
        {t('title')}
      </h3>
      {isPending ? (
        <Skeleton className="h-20" />
      ) : isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('failed')}
        </p>
      ) : (
        <div className="grid gap-4 rounded-card border border-border bg-surface-1 p-4">
          {data.awarded.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('none')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={t('awarded')}>
              {data.awarded.map((sticker) => (
                <li key={sticker.key} className="grid justify-items-center gap-1.5">
                  <Sticker stickerKey={sticker.key} size={64} />
                  {sticker.revocable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      aria-label={t('revoke', { name: tName(sticker.key) })}
                      onClick={() => revoke.mutate(sticker.key)}
                    >
                      ×
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {data.awardable.length > 0 ? (
            <div className="grid gap-2 border-t border-border pt-3">
              <p className="text-sm text-fg-muted">{t('help')}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {data.awardable.map((key) => (
                  <li key={key}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={give.isPending}
                      aria-label={t('giveNamed', { name: tName(key) })}
                      onClick={() => give.mutate(key)}
                    >
                      {t('give')} · {tName(key)}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t('nothingToGive')}</p>
          )}
          {give.isError || revoke.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t('failed')}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
