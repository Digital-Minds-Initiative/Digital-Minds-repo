import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Logo } from '@/components/shell/logo';
import { resolveLocale } from '@/i18n/locale';

/**
 * The layout of the committee view link's page (/v/<token>): the logo and nothing to follow. The
 * people opening it come from a shared link to read their points, so there is no sign-in or
 * sign-up here, and no link of any kind (docs/adr/0023-committee-view-link.md).
 */
export default async function ViewLayout({ children, params }: LayoutProps<'/[locale]'>) {
  await resolveLocale(params);
  return <ViewShell>{children}</ViewShell>;
}

function ViewShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>
      <header className="flex justify-center border-b border-border px-4 py-4">
        <Logo />
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
