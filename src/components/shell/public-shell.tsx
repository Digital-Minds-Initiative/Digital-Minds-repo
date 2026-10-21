import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { DELAYS } from '@/components/motion/delays';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { WaveDivider } from '@/components/ui/wave-divider';
import { Link } from '@/i18n/navigation';

import { InteractiveLogo } from './interactive-logo';
import { PublicHeader } from './public-header';
import { ThemeToggle } from './theme-toggle';

/** Plain layout for public pages (landing, later the public committee view). */
export function PublicShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>
      <PublicHeader
        logo={
          // On the narrowest screens the mark alone leaves room for both buttons.
          <InteractiveLogo nameClassName="max-[419px]:sr-only" />
        }
        actions={
          <>
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
          </>
        }
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="bg-surface-2">
        <Reveal variant="clip">
          <WaveDivider />
        </Reveal>
        <Reveal delay={DELAYS.dividerLead + 500}>
          <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-fg-muted">
            {t('public.footer', { year: String(new Date().getFullYear()) })}
          </div>
        </Reveal>
      </footer>
    </div>
  );
}
