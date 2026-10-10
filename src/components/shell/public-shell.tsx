import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

/** Plain layout for public pages (landing, later the public committee view and login). */
export function PublicShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface-1">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            href="/"
            className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/dashboard">{t('public.signIn')}</Link>
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border bg-surface-2">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-fg-muted">
          {t('public.footer', { year: String(new Date().getFullYear()) })}
        </div>
      </footer>
    </div>
  );
}
