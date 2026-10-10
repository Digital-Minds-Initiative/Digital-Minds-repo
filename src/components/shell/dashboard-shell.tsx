'use client';

import { LogIn, Menu, RotateCw, ShieldOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { useMe, UserMenu } from '@/client/features/auth';
import { ApiError } from '@/client/lib/api-client';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';

import { DashboardNav } from './dashboard-nav';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

// Development only: compiled out of production builds.
const DevActorSwitcher =
  process.env.NODE_ENV === 'production'
    ? () => null
    : dynamic(() => import('./dev-actor-switcher'), { ssr: false });

/** Admin area layout: sidebar (start side), header, and content gated on the signed-in actor. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-e border-border bg-surface-2 p-4 lg:flex">
        <Link
          href="/"
          className="rounded-md px-2 outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Logo />
        </Link>
        <DashboardNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface-1/90 px-4 backdrop-blur-sm lg:px-8">
          <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <DialogPrimitive.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={t('sidebar.open')}
              >
                <Menu aria-hidden />
              </Button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-backdrop data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden" />
              <DialogPrimitive.Content className="fixed inset-y-0 start-0 z-50 flex w-72 flex-col gap-6 border-e border-border bg-surface-2 p-4 shadow-lg data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden">
                <DialogPrimitive.Title className="sr-only">{t('nav.label')}</DialogPrimitive.Title>
                <Logo />
                <DashboardNav onNavigate={() => setMobileNavOpen(false)} />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <Logo showName={false} className="lg:hidden" />

          <div className="ms-auto flex items-center gap-1">
            <DevActorSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="flex-1 px-4 py-6 lg:px-8">
          <ActorGate>{children}</ActorGate>
        </main>
      </div>
    </div>
  );
}

/** Shows the page only to actors with dashboard access; explains why otherwise. */
function ActorGate({ children }: { children: ReactNode }) {
  const t = useTranslations('dashboard');
  const tErrors = useTranslations('common.errors');
  const tActions = useTranslations('common.actions');
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="grid gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (me.error instanceof ApiError && me.error.status === 401) {
    return (
      <EmptyState
        icon={LogIn}
        title={t('signedOut.title')}
        description={
          process.env.NODE_ENV === 'production' ? t('signedOut.body') : t('signedOut.devBody')
        }
      />
    );
  }
  if (me.isError) {
    const code = me.error instanceof ApiError ? me.error.code : 'INTERNAL';
    return (
      <EmptyState
        title={tErrors(code)}
        action={
          <Button variant="outline" onClick={() => void me.refetch()}>
            <RotateCw aria-hidden />
            {tActions('retry')}
          </Button>
        }
      />
    );
  }
  if (!me.data.access.canAccessDashboard) {
    return (
      <EmptyState icon={ShieldOff} title={t('noAccess.title')} description={t('noAccess.body')} />
    );
  }
  return children;
}
