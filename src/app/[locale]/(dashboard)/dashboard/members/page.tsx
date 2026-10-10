import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';
import { MembersTable } from '@/modules/members';

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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      {/* MembersTable reads the URL query (useSearchParams), which needs a Suspense boundary. */}
      <Suspense>
        <MembersTable />
      </Suspense>
    </div>
  );
}
