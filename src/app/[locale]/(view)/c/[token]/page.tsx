import type { Metadata } from 'next';

import { PublicCardPage } from '@/client/features/wallet';
import { resolveLocale } from '@/i18n/locale';

/*
 * The page a member's QR opens (docs/adr/0032-card-link-and-stickers.md). The URL is the
 * permission, so the page is kept out of search engines and never sends it on as a Referer
 * (next.config.ts sets the same two rules as headers for /c/). The title stays the app's name:
 * the token and the member never appear in it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function MemberCardPage({ params }: PageProps<'/[locale]/c/[token]'>) {
  await resolveLocale(params);
  const { token } = await params;
  return <PublicCardPage token={token} />;
}
