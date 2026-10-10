import { PublicShell } from '@/components/shell/public-shell';
import { resolveLocale } from '@/i18n/locale';

export default async function PublicLayout({ children, params }: LayoutProps<'/[locale]'>) {
  await resolveLocale(params);
  return <PublicShell>{children}</PublicShell>;
}
