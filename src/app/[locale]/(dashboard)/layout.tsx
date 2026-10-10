import { DashboardShell } from '@/components/shell/dashboard-shell';
import { resolveLocale } from '@/i18n/locale';

/*
 * Pages in the dashboard render feature components that fetch through /api/v1 with TanStack Query.
 * They never call services directly — that keeps MSW mode, the mobile app and the web app on the
 * same API (docs/adr/0006-data-through-the-api.md).
 */
export default async function DashboardLayout({ children, params }: LayoutProps<'/[locale]'>) {
  await resolveLocale(params);
  return <DashboardShell>{children}</DashboardShell>;
}
