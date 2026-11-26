import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MyCards } from '@/client/features/wallet';
import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/profile'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'wallet.profile' });
  return { title: t('title') };
}

export default async function ProfilePage({ params }: PageProps<'/[locale]/dashboard/profile'>) {
  await resolveLocale(params);
  const t = await getTranslations('wallet.profile');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <MyCards withQrPage />
    </div>
  );
}
