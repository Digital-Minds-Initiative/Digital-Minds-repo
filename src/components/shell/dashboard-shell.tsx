'use client';

import { LogIn, Menu, PanelLeftClose, PanelLeftOpen, RotateCw, ShieldOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { useMe, UserMenu } from '@/client/features/auth';
import { ApiError } from '@/client/lib/api-client';
import { cn } from '@/client/lib/utils';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, usePathname } from '@/i18n/navigation';

import { DashboardNav } from './dashboard-nav';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

/**
 * The persona switcher appears only where the server will honour it: never in a production build
 * (compiled out), and in development only with DEV_ACTOR_SWITCHER=true — the same flag
 * `resolveActor` checks, passed to the browser by next.config.ts. A button the server ignores
 * would only mislead.
 */
const devActorSwitcherEnabled =
  process.env.NODE_ENV !== 'production' && process.env.DEV_ACTOR_SWITCHER === 'true';

const DevActorSwitcher = devActorSwitcherEnabled
  ? dynamic(() => import('./dev-actor-switcher'), { ssr: false })
  : () => null;

const SIDEBAR_KEY = 'dm-sidebar-collapsed';
const SIDEBAR_EVENT = 'dm-sidebar-change';

function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage can be blocked; the toggle still works for this visit through the event below.
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

/** Admin area layout: sidebar (start side), header, and content gated on the signed-in actor. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The desktop sidebar can shrink to an icon rail to give the page more width; the choice is remembered.
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  // Slide only once the user has used the toggle, so a saved choice does not animate on load.
  const [animate, setAnimate] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
      >
        {t('skipToContent')}
      </a>

      <aside
        id="dashboard-sidebar"
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-e border-border bg-surface-2 lg:block',
          animate &&
            'motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-in-out',
          // Collapsed it is not hidden: it shrinks to a rail with one icon per page.
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <div className="flex h-full flex-col gap-6 p-4">
          <div
            className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}
          >
            {collapsed ? null : (
              <Link
                href="/"
                className="rounded-md px-2 outline-none focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Logo />
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
              aria-expanded={!collapsed}
              aria-controls="dashboard-sidebar"
              onClick={() => {
                setAnimate(true);
                saveSidebarCollapsed(!collapsed);
              }}
            >
              <DirectionalIcon icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
            </Button>
          </div>
          <DashboardNav collapsed={collapsed} />
        </div>
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

/** Shows a page only to actors with dashboard access — except the home page, open to every member. */
function ActorGate({ children }: { children: ReactNode }) {
  const t = useTranslations('dashboard');
  const tErrors = useTranslations('common.errors');
  const tActions = useTranslations('common.actions');
  const me = useMe();
  const pathname = usePathname();

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
        description={devActorSwitcherEnabled ? t('signedOut.devBody') : t('signedOut.body')}
        action={
          <Button asChild>
            <Link href="/login">{t('signedOut.action')}</Link>
          </Button>
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
  // The home page is everyone's: someone who manages nothing sees their own memberships there.
  // The management screens stay closed to them.
  if (!me.data.access.canAccessDashboard && pathname !== '/dashboard') {
    return (
      <EmptyState icon={ShieldOff} title={t('noAccess.title')} description={t('noAccess.body')} />
    );
  }
  return children;
}
