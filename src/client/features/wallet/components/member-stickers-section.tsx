'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { apiClient } from '@/client/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  awardStickerEndpoint,
  listMemberStickersEndpoint,
  revokeStickerEndpoint,
  type AwardableSticker,
} from '@/shared/contracts/cards';
import { CUSTOM_STICKER_LIMITS } from '@/shared/lib/stickers';

import { Sticker } from './sticker';
import { useStickerText } from '../hooks/use-sticker-text';

/**
 * In a member's file: the stickers they were awarded, and the ones the person looking may give
 * them, built-in and the ones the club's leaders designed. The server decides both lists from the
 * viewer's standing (an officer may give any, a lead the ones open to leads, nobody their own), so
 * this only shows what it is told. Giving one asks for an optional line: what it is for, which the
 * sticker's page shows.
 */
export function MemberStickersSection({ memberId }: { memberId: string }) {
  const t = useTranslations('wallet.award');
  const text = useStickerText();
  const queryClient = useQueryClient();
  const queryKey = ['member-stickers', memberId] as const;
  const [pick, setPick] = useState<AwardableSticker | null>(null);
  const [reason, setReason] = useState('');

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.request(listMemberStickersEndpoint, { params: { memberId } }, { signal }),
  });
  const designs = new Map<string, NonNullable<typeof data>['custom'][number]>(
    data?.custom.map((def) => [def.key, def]) ?? [],
  );
  const design = (key: AwardableSticker) => designs.get(key) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const give = useMutation({
    mutationFn: (input: { key: AwardableSticker; reason: string }) =>
      apiClient.request(awardStickerEndpoint, {
        params: { memberId },
        body: { key: input.key, ...(input.reason.trim() ? { reason: input.reason.trim() } : {}) },
      }),
    onSuccess: () => {
      setPick(null);
      setReason('');
      return refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (key: AwardableSticker) =>
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
                  <Sticker stickerKey={sticker.key} custom={design(sticker.key)} size={64} />
                  {sticker.reason ? (
                    <span className="max-w-24 text-center text-[11px] leading-5 text-fg-muted">
                      {sticker.reason}
                    </span>
                  ) : null}
                  {sticker.revocable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      aria-label={t('revoke', {
                        name: text.name(sticker.key, design(sticker.key)),
                      })}
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
            <div className="grid gap-3 border-t border-border pt-3">
              <p className="text-sm text-fg-muted">{t('help')}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {data.awardable.map((key) => (
                  <li key={key}>
                    <Button
                      variant={pick === key ? 'primary' : 'outline'}
                      size="sm"
                      aria-pressed={pick === key}
                      aria-label={t('giveNamed', { name: text.name(key, design(key)) })}
                      onClick={() => setPick(pick === key ? null : key)}
                    >
                      {t('give')} · {text.name(key, design(key))}
                    </Button>
                  </li>
                ))}
              </ul>
              {pick ? (
                <form
                  className="grid gap-2 rounded-lg bg-surface-2 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    give.mutate({ key: pick, reason });
                  }}
                >
                  <label className="grid gap-1 text-sm" htmlFor="award-reason">
                    <span className="font-medium">{t('reasonLabel')}</span>
                    <span className="text-xs text-fg-muted">{t('reasonHint')}</span>
                  </label>
                  <Input
                    id="award-reason"
                    value={reason}
                    maxLength={CUSTOM_STICKER_LIMITS.reason}
                    placeholder={t('reasonPlaceholder')}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={give.isPending}>
                      {t('confirm', { name: text.name(pick, design(pick)) })}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPick(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </form>
              ) : null}
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
