import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MembersPage as MembersScreen } from '@/client/features/members';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/members'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'members.page' });
  return { title: t('title') };
}

export default async function MembersPage({ params }: PageProps<'/[locale]/dashboard/members'>) {
  await resolveLocale(params);
  const t = await getTranslations('members.page');
  return <MembersScreen title={t('title')} description={t('description')} />;
}
