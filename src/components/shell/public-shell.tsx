import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { WaveDivider } from '@/components/ui/wave-divider';
import { Link } from '@/i18n/navigation';

import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

/** Plain layout for public pages (landing, later the public committee view). */
export function PublicShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const tCommon = useTranslations('common');
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>
      <header className="border-b border-border bg-surface-1">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4">
          <Link
            href="/"
            aria-label={tCommon('appName')}
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            {/* On the narrowest screens the mark alone leaves room for both buttons. */}
            <Logo nameClassName="max-[419px]:hidden" />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" className="px-3 text-xs sm:px-5 sm:text-sm">
              <Link href="/login">{t('public.signIn')}</Link>
            </Button>
            <Button
              asChild
              className="border-tuwaiq-lilac bg-tuwaiq-lilac px-3 text-xs text-deep hover:bg-tuwaiq-lilac/85 sm:px-5 sm:text-sm"
            >
              <Link href="/register">{t('public.signUp')}</Link>
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="bg-surface-2">
        <WaveDivider />
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-fg-muted">
          {t('public.footer', { year: String(new Date().getFullYear()) })}
        </div>
      </footer>
    </div>
  );
}
