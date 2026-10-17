'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PixelIcon, type PixelIconName } from '@/components/ui/pixel-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, usePathname } from '@/i18n/navigation';

interface NavItem {
  key: 'dashboard' | 'members' | 'points' | 'clubs' | 'permissions';
  icon: PixelIconName;
  /** Omitted for sections that are not built yet. */
  href?: string;
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', icon: 'grid', href: '/dashboard', exact: true },
  { key: 'members', icon: 'people', href: '/dashboard/members' },
  { key: 'points', icon: 'trophy', href: '/dashboard/points' },
  { key: 'clubs', icon: 'building', href: '/dashboard/clubs' },
  { key: 'permissions', icon: 'shield', href: '/dashboard/permissions' },
];

interface DashboardNavProps {
  onNavigate?: () => void;
  /** Icons only (the desktop rail): the names stay available to screen readers and as tooltips. */
  collapsed?: boolean;
}

export function DashboardNav({ onNavigate, collapsed = false }: DashboardNavProps) {
  const t = useTranslations('shell.nav');
  const tStates = useTranslations('common.states');
  const pathname = usePathname();

  /** In the rail each icon gets a tooltip with the page name, on the side facing the content. */
  const withTooltip = (label: string, element: ReactElement) =>
    collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{element}</TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    ) : (
      element
    );

  return (
    <nav aria-label={t('label')}>
      <ul className="grid gap-1">
        {NAV_ITEMS.map((item) => {
          const label = t(item.key);
          const className = cn(
            'flex h-10 items-center rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring',
            collapsed ? 'justify-center' : 'gap-3 px-3',
          );
          const text = <span className={cn(collapsed && 'sr-only')}>{label}</span>;

          if (!item.href) {
            return (
              <li key={item.key}>
                {withTooltip(
                  `${label} · ${tStates('comingSoon')}`,
                  <span
                    aria-disabled
                    className={cn(className, 'cursor-not-allowed text-fg-subtle')}
                  >
                    <PixelIcon name={item.icon} />
                    {text}
                    {collapsed ? (
                      <span className="sr-only">{tStates('comingSoon')}</span>
                    ) : (
                      <Badge variant="neutral" className="ms-auto">
                        {tStates('comingSoon')}
                      </Badge>
                    )}
                  </span>,
                )}
              </li>
            );
          }
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.key}>
              {withTooltip(
                label,
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    className,
                    active
                      ? 'bg-primary-subtle text-primary-subtle-fg'
                      : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  <PixelIcon name={item.icon} />
                  {text}
                </Link>,
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
