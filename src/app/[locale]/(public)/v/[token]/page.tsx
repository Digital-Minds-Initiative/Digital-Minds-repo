import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PublicCommitteeView } from '@/client/features/clubs';
import { resolveLocale } from '@/i18n/locale';

/*
 * The page a committee's view-only link opens (docs/adr/0023-committee-view-link.md). The URL is
 * the permission, so the page is kept out of search engines and never sends it on as a Referer
 * (next.config.ts sets the same two rules as headers for /v/). The title stays the app's name:
 * the token never appears in it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function CommitteeViewPage({ params }: PageProps<'/[locale]/v/[token]'>) {
  await resolveLocale(params);
  const { token } = await params;
  return (
    // The view keeps the open member in the URL (useSearchParams), which needs a Suspense boundary.
    <Suspense>
      <PublicCommitteeView token={token} />
    </Suspense>
  );
}
