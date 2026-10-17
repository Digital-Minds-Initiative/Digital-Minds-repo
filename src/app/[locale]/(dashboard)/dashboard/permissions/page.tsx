import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PermissionsScreen } from '@/client/features/permissions';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/permissions'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'permissions.page' });
  return { title: t('title') };
}

export default async function PermissionsPage({
  params,
}: PageProps<'/[locale]/dashboard/permissions'>) {
  await resolveLocale(params);
  const t = await getTranslations('permissions.page');
  return <PermissionsScreen title={t('title')} description={t('description')} />;
}
