'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { apiClient } from '@/client/lib/api-client';
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

/** Apple's mark, drawn as one filled shape so it takes the badge's text colour. */
function AppleMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.4 6.62 1.1 8.79.73 1.06 1.6 2.25 2.75 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.19-.02 1.94-1.08 2.66-2.15.84-1.23 1.19-2.42 1.2-2.48-.03-.01-2.3-.88-2.31-3.53ZM14.2 6.1c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.57-1.22Z" />
    </svg>
  );
}

/** A wallet, drawn as one stroke: Google Wallet's own glyph is a wallet with a coloured tab. */
function WalletMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="6" width="18" height="13" rx="3" fill="#4285F4" />
      <path d="M3 9a3 3 0 0 1 3-3h10" stroke="#34A853" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M21 10v-.5A3.5 3.5 0 0 0 17.5 6"
        stroke="#EA4335"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="14" y="11.5" width="7" height="4" rx="2" fill="#FBBC04" />
      <circle cx="16.6" cy="13.5" r="0.9" fill="#fff" />
    </svg>
  );
}

/**
 * One wallet as a badge, the way each platform shows "add this to your wallet": a black, rounded
 * rectangle with the wallet's mark on one side and two lines of text, the small «add to» above the
 * wallet's name. Both badges are the same size so the pair reads as one row of choices.
 */
const badgeClass =
  'group relative flex h-14 w-full items-center gap-3 rounded-[12px] border border-white/25 bg-black px-4 text-white outline-none transition-[transform,box-shadow,opacity] duration-150 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none';

function BadgeText({ addTo, name }: { addTo: string; name: string }) {
  return (
    <span aria-hidden className="grid min-w-0 flex-1 justify-items-start gap-0.5 leading-none">
      <span className="text-[11px] font-medium opacity-80">{addTo}</span>
      <span
        dir="ltr"
        className="w-fit max-w-full truncate text-[19px] font-semibold tracking-[-0.01em]"
      >
        {name}
      </span>
    </span>
  );
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
      aria-label={t('apple')}
      className={badgeClass}
    >
      <AppleMark className="size-7 shrink-0" />
      <BadgeText addTo={t('addTo')} name="Apple Wallet" />
    </a>
  ) : (
    <span
      key="apple"
      aria-disabled
      aria-label={t('apple')}
      className={`${badgeClass} cursor-not-allowed opacity-60`}
    >
      <AppleMark className="size-7 shrink-0" />
      <BadgeText addTo={t('addTo')} name="Apple Wallet" />
    </span>
  );

  const googleButton = card.wallet.google ? (
    <button
      key="google"
      type="button"
      onClick={() => google.mutate()}
      aria-busy={google.isPending}
      disabled={google.isPending}
      aria-label={google.isPending ? t('preparing') : t('google')}
      className={`${badgeClass} cursor-pointer disabled:opacity-70`}
    >
      <WalletMark
        className={`size-7 shrink-0 ${google.isPending ? 'motion-safe:animate-pulse' : ''}`}
      />
      <BadgeText addTo={t('addTo')} name="Google Wallet" />
    </button>
  ) : (
    <span
      key="google"
      aria-disabled
      aria-label={t('google')}
      className={`${badgeClass} cursor-not-allowed opacity-60`}
    >
      <WalletMark className="size-7 shrink-0" />
      <BadgeText addTo={t('addTo')} name="Google Wallet" />
    </span>
  );

  const buttons = device === 'android' ? [googleButton, apple] : [apple, googleButton];
  const anyAvailable = card.wallet.apple || card.wallet.google;

  return (
    <div className="grid gap-2">
      <div className="grid gap-2">{buttons}</div>
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
