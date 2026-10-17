import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PointsScreen } from '@/client/features/points';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/points'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'points.page' });
  return { title: t('title') };
}

export default async function PointsPage({ params }: PageProps<'/[locale]/dashboard/points'>) {
  await resolveLocale(params);
  const t = await getTranslations('points.page');
  // The header (with the two views) is drawn by the screen, which owns the tabs.
  return <PointsScreen title={t('title')} description={t('description')} />;
}
