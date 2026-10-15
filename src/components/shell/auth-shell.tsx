import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Logo } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Link } from '@/i18n/navigation';

/**
 * The sign-in surface: the page background and grid follow the theme (light canvas / deep purple),
 * with a single notebook page centred on it.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas text-fg transition-colors dark:bg-deep">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.045] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-fg-muted) 1px, transparent 1px), linear-gradient(90deg, var(--color-fg-muted) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>
      <header className="relative z-10 mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <Logo />
        </Link>
        <ThemeToggle className="size-12 [&_svg:not([class*=size-])]:size-6" />
      </header>
      <main
        id="main"
        className="relative z-10 flex flex-1 items-center justify-center px-4 pt-4 pb-12 sm:pb-16"
      >
        {children}
      </main>
    </div>
  );
}
