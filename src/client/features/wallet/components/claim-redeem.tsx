'use client';

import { PartyPopper, ScanLine } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '@/client/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { CLAIM_CODE_PATTERN } from '@/shared/contracts/stickers';

import { Sticker } from './sticker';
import { useRedeemClaim } from '../hooks/use-custom-stickers';
import { useStickerText } from '../hooks/use-sticker-text';

/** The reasons a code can be refused, each with its own sentence. Anything else gets the general one. */
const KNOWN_REASONS = [
  'claim_expired',
  'claim_full',
  'already_claimed',
  'already_holds',
  'claim_not_for_you',
  'sticker_archived',
  'sticker_not_available',
  'sticker_sold_out',
] as const;

/**
 * What a phone opens when it scans an event code (`/dashboard/claim?c=<code>`), and a box to type
 * the code if the camera could not. It redeems once, then shows the sticker dropping in.
 */
export function ClaimRedeem() {
  const t = useTranslations('wallet.claim');
  const text = useStickerText();
  const params = useSearchParams();
  const redeem = useRedeemClaim();
  const [typed, setTyped] = useState('');
  // A code in the address is used once, even where React runs an effect twice in development.
  const used = useRef<string | null>(null);
  const fromAddress = params.get('c');

  useEffect(() => {
    if (!fromAddress || used.current === fromAddress) return;
    used.current = fromAddress;
    if (CLAIM_CODE_PATTERN.test(fromAddress)) redeem.mutate(fromAddress);
  }, [fromAddress, redeem]);

  const error = redeem.error instanceof ApiError ? redeem.error : null;
  const reason = error?.details.reason;
  const known = KNOWN_REASONS.find((value) => value === reason);
  const wrongCode = Boolean(fromAddress) && !CLAIM_CODE_PATTERN.test(fromAddress ?? '');

  if (redeem.isSuccess) {
    const { key, custom, title, clubName } = redeem.data;
    return (
      <section
        aria-live="polite"
        className="mx-auto grid max-w-md justify-items-center gap-5 rounded-card border border-border bg-surface-1 p-8 text-center"
      >
        <PartyPopper aria-hidden className="size-7 text-primary" />
        <h2 className="m-0 text-2xl font-semibold">{t('got')}</h2>
        <div className="motion-safe:animate-[sticker-stick_480ms_var(--ease-out)_backwards]">
          <div className="motion-safe:animate-[sticker-float_5s_ease-in-out_infinite]">
            <Sticker
              stickerKey={key}
              custom={custom}
              size={170}
              className="[filter:drop-shadow(0_14px_10px_color-mix(in_oklab,black_28%,transparent))]"
            />
          </div>
        </div>
        <div className="grid gap-1">
          <b className="text-lg">{text.name(key, custom)}</b>
          <span className="text-sm text-fg-muted">
            {title} · {clubName}
          </span>
        </div>
        <Button asChild>
          <Link href="/dashboard/profile">{t('stick')}</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-md gap-5 rounded-card border border-border bg-surface-1 p-8">
      <div className="grid justify-items-center gap-3 text-center">
        <ScanLine aria-hidden className="size-7 text-primary" />
        <h2 className="m-0 text-xl font-semibold">{t('title')}</h2>
        <p className="m-0 text-sm text-fg-muted">{t('hint')}</p>
      </div>

      {redeem.isPending ? <Skeleton className="h-12" aria-label={t('working')} /> : null}

      {redeem.isError || wrongCode ? (
        <p
          role="alert"
          className="m-0 rounded-lg bg-danger-subtle p-3 text-sm text-danger-subtle-fg"
        >
          {wrongCode || error?.status === 404
            ? t('errors.invalid')
            : error?.status === 429
              ? t('errors.tooFast')
              : known
                ? t(`errors.${known}`)
                : t('errors.general')}
        </p>
      ) : null}

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const code = typed.trim();
          if (CLAIM_CODE_PATTERN.test(code)) redeem.mutate(code);
        }}
      >
        <label className="grid gap-1.5 text-sm font-semibold">
          {t('typeIt')}
          <Input
            dir="ltr"
            value={typed}
            placeholder="xxxxxxxx-xxxx-…"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          loading={redeem.isPending}
          disabled={!CLAIM_CODE_PATTERN.test(typed.trim())}
        >
          {t('claim')}
        </Button>
      </form>
    </section>
  );
}
