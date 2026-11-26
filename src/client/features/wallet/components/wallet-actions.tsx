'use client';

import { useMutation } from '@tanstack/react-query';
import { Apple } from 'lucide-react';
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

/** Google's «G», drawn as one stroke so it takes the button's colour like the Apple mark does. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M19 7.2A8 8 0 1 0 20 12h-7.5" />
    </svg>
  );
}

/** One wallet as an icon: square, side by side with the other, named for a screen reader and on hover. */
const walletButton = (variant: 'primary' | 'outline', className?: string) =>
  buttonVariants({
    variant,
    size: 'lg',
    className: `h-12 flex-1 justify-center transition-transform duration-150 active:scale-95 motion-reduce:transition-none ${className ?? ''}`,
  });

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
      title={t('apple')}
      className={walletButton('primary')}
    >
      <Apple aria-hidden className="size-6" />
      <span className="sr-only">{t('apple')}</span>
    </a>
  ) : (
    <span
      key="apple"
      aria-disabled
      title={t('apple')}
      className={walletButton('outline', 'opacity-60')}
    >
      <Apple aria-hidden className="size-6" />
      <span className="sr-only">{t('apple')}</span>
    </span>
  );

  const googleButton = card.wallet.google ? (
    <button
      key="google"
      type="button"
      onClick={() => google.mutate()}
      aria-busy={google.isPending}
      disabled={google.isPending}
      title={google.isPending ? t('preparing') : t('google')}
      className={walletButton('primary')}
    >
      <GoogleIcon className={`size-6 ${google.isPending ? 'motion-safe:animate-spin' : ''}`} />
      <span className="sr-only">{google.isPending ? t('preparing') : t('google')}</span>
    </button>
  ) : (
    <span
      key="google"
      aria-disabled
      title={t('google')}
      className={walletButton('outline', 'opacity-60')}
    >
      <GoogleIcon className="size-6" />
      <span className="sr-only">{t('google')}</span>
    </span>
  );

  const buttons = device === 'android' ? [googleButton, apple] : [apple, googleButton];
  const anyAvailable = card.wallet.apple || card.wallet.google;

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">{buttons}</div>
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
