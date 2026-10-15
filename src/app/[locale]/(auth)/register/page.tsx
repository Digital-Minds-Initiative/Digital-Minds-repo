import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SignInFlow } from '@/client/features/auth';
import { resolveLocale } from '@/i18n/locale';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/register'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return { title: t('title') };
}

export default async function RegisterPage({ params }: PageProps<'/[locale]/register'>) {
  await resolveLocale(params);
  return <SignInFlow mode="register" />;
}
