import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ClaimRedeem } from '@/client/features/wallet';
import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/claim'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'wallet.claim' });
  return { title: t('title'), referrer: 'no-referrer', robots: { index: false } };
}

export default async function ClaimPage({ params }: PageProps<'/[locale]/dashboard/claim'>) {
  await resolveLocale(params);
  const t = await getTranslations('wallet.claim');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('hint')} />
      <Suspense fallback={null}>
        <ClaimRedeem />
      </Suspense>
    </div>
  );
}
