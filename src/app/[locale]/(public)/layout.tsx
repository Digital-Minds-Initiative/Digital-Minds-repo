import { PublicShell } from '@/components/shell/public-shell';
import { resolveLocale } from '@/i18n/locale';
import { selfSignupEnabled } from '@/shared/lib/self-signup';

export default async function PublicLayout({ children, params }: LayoutProps<'/[locale]'>) {
  await resolveLocale(params);
  return <PublicShell selfSignup={selfSignupEnabled()}>{children}</PublicShell>;
}
