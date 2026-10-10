'use client';

import {
  Building2,
  LayoutDashboard,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  key: 'dashboard' | 'members' | 'points' | 'clubs' | 'permissions';
  icon: LucideIcon;
  /** Omitted for sections that are not built yet. */
  href?: string;
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', icon: LayoutDashboard, href: '/dashboard', exact: true },
  { key: 'members', icon: Users, href: '/dashboard/members' },
  { key: 'points', icon: Trophy },
  { key: 'clubs', icon: Building2 },
  { key: 'permissions', icon: ShieldCheck },
];

export function DashboardNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('shell.nav');
  const tStates = useTranslations('common.states');
  const pathname = usePathname();

  return (
    <nav aria-label={t('label')}>
      <ul className="grid gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const className =
            'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring';
          if (!item.href) {
            return (
              <li key={item.key}>
                <span aria-disabled className={cn(className, 'cursor-not-allowed text-fg-subtle')}>
                  <Icon className="size-4" aria-hidden />
                  {t(item.key)}
                  <Badge variant="neutral" className="ms-auto">
                    {tStates('comingSoon')}
                  </Badge>
                </span>
              </li>
            );
          }
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.key}>
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
                <Icon className="size-4" aria-hidden />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
