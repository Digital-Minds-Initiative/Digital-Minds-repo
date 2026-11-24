'use client';

import { useMutation } from '@tanstack/react-query';
import { Smartphone, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { apiClient } from '@/client/lib/api-client';
import { buttonVariants } from '@/components/ui/button';
import { googleWalletEndpoint, type MemberCard } from '@/shared/contracts/wallet';

type Device = 'ios' | 'android' | 'other';

/** The device the page is open on, so the wallet that belongs to it comes first. */
export function detectDevice(userAgent: string, maxTouchPoints = 0): Device {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPadOS asks for the desktop site and says it is a Mac, but has a touch screen.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

const subscribe = () => () => undefined;
const serverDevice = (): Device => 'other';
const clientDevice = (): Device => detectDevice(navigator.userAgent, navigator.maxTouchPoints);

/**
 * "Add to wallet", for every device. Apple Wallet is a link (Safari on an iPhone receives the
 * `.pkpass` and offers to add it); Google Wallet asks the server for a signed address and opens
 * it. The one that matches the device is shown first, both are shown on a computer, and a wallet
 * the server is not set up for is shown off with a line that says so, so the page never looks
 * broken. The card on this page works on any device with or without them.
 */
export function WalletActions({
  card,
  navigate = (url) => window.location.assign(url),
}: {
  card: MemberCard;
  /** Where the Google link is opened; the browser's own navigation unless a test says otherwise. */
  navigate?: (url: string) => void;
}) {
  const t = useTranslations('wallet.add');
  const device = useSyncExternalStore(subscribe, clientDevice, serverDevice);

  const google = useMutation({
    mutationFn: () =>
      apiClient.request(googleWalletEndpoint, { params: { membershipId: card.membershipId } }),
    onSuccess: ({ url }) => navigate(url),
  });

  const apple = card.wallet.apple ? (
    <a
      key="apple"
      href={`/api/v1/me/cards/${card.membershipId}/wallet-pass`}
      className={buttonVariants({ variant: 'primary', size: 'lg' })}
    >
      <Wallet aria-hidden />
      {t('apple')}
    </a>
  ) : (
    <span
      key="apple"
      aria-disabled
      className={buttonVariants({ variant: 'outline', size: 'lg', className: 'opacity-60' })}
    >
      <Wallet aria-hidden />
      {t('apple')}
    </span>
  );

  const googleButton = card.wallet.google ? (
    <button
      key="google"
      type="button"
      onClick={() => google.mutate()}
      aria-busy={google.isPending}
      disabled={google.isPending}
      className={buttonVariants({ variant: 'primary', size: 'lg' })}
    >
      <Smartphone aria-hidden />
      {google.isPending ? t('preparing') : t('google')}
    </button>
  ) : (
    <span
      key="google"
      aria-disabled
      className={buttonVariants({ variant: 'outline', size: 'lg', className: 'opacity-60' })}
    >
      <Smartphone aria-hidden />
      {t('google')}
    </span>
  );

  const buttons = device === 'android' ? [googleButton, apple] : [apple, googleButton];
  const anyAvailable = card.wallet.apple || card.wallet.google;

  return (
    <div className="grid gap-2">
      {buttons}
      {google.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('failed')}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          {anyAvailable ? t(`hint.${device}`) : t('unavailable')}
        </p>
      )}
    </div>
  );
}
