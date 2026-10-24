import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SignInFlow } from '@/client/features/auth';
import { resolveLocale } from '@/i18n/locale';
import { selfSignupEnabled } from '@/shared/lib/self-signup';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.login' });
  return { title: t('title') };
}

export default async function LoginPage({ params }: PageProps<'/[locale]/login'>) {
  await resolveLocale(params);
  return <SignInFlow mode="login" selfSignup={selfSignupEnabled()} />;
}
