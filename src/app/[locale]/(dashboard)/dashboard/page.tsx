import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';
import { AccountOverview } from '@/modules/auth';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('title') };
}

export default async function DashboardPage({ params }: PageProps<'/[locale]/dashboard'>) {
  await resolveLocale(params);
  const t = await getTranslations('dashboard');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('welcomeDescription')} />
      <AccountOverview />
    </div>
  );
}
