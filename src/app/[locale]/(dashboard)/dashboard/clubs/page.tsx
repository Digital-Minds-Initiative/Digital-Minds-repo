import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ClubsScreen } from '@/client/features/clubs';
import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/clubs'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'clubs.page' });
  return { title: t('title') };
}

export default async function ClubsPage({ params }: PageProps<'/[locale]/dashboard/clubs'>) {
  await resolveLocale(params);
  const t = await getTranslations('clubs.page');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <ClubsScreen />
    </div>
  );
}
