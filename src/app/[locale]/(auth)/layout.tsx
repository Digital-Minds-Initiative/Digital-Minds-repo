import { AuthShell } from '@/components/shell/auth-shell';
import { resolveLocale } from '@/i18n/locale';

export default async function AuthLayout({ children, params }: LayoutProps<'/[locale]'>) {
  await resolveLocale(params);
  return <AuthShell>{children}</AuthShell>;
}
