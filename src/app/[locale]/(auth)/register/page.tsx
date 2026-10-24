import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SignInFlow } from '@/client/features/auth';
import { resolveLocale } from '@/i18n/locale';
import { redirect } from '@/i18n/navigation';
import { selfSignupEnabled } from '@/shared/lib/self-signup';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/register'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return { title: t('title') };
}

/** With sign-up off (AUTH_SELF_SIGNUP=false, ADR 0027) there is nothing to register: go to sign-in. */
export default async function RegisterPage({ params }: PageProps<'/[locale]/register'>) {
  const locale = await resolveLocale(params);
  if (!selfSignupEnabled()) redirect({ href: '/login', locale });
  return <SignInFlow mode="register" selfSignup />;
}
