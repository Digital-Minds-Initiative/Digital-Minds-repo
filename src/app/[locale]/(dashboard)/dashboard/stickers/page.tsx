import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { StickerStudio } from '@/client/features/wallet';
import { PageHeader } from '@/components/patterns/page-header';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dashboard/stickers'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'wallet.studio' });
  return { title: t('title') };
}

export default async function StickersPage({ params }: PageProps<'/[locale]/dashboard/stickers'>) {
  await resolveLocale(params);
  const t = await getTranslations('wallet.studio');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <StickerStudio />
    </div>
  );
}
