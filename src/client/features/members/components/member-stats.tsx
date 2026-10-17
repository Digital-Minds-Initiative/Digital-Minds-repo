'use client';

import { Clock3, ShieldCheck, UserCheck, UsersRound, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { Me } from '@/shared/contracts/auth';

import { useMemberCounts, useRoleHolderCount } from '../hooks/use-member-stats';

interface MemberStatsProps {
  access: Me['access'] | undefined;
  /** The club chosen in the filters, when one is; otherwise every club in the person's scope. */
  clubId: string | undefined;
}

/**
 * Four numbers above the filters: all members, those who have signed up (green), those still
 * waiting to (orange), and the people who hold a management role. The last card is for people who
 * manage a club — only they may read who holds the roles — and is left out for everyone else.
 */
export function MemberStats({ access, clubId }: MemberStatsProps) {
  const t = useTranslations('members.stats');
  const format = useFormatter();
  const counts = useMemberCounts(clubId);
  const managed = (access?.clubs ?? [])
    .filter((club) => club.canManage && (!clubId || club.id === clubId))
    .map((club) => club.id);
  const holders = useRoleHolderCount(managed);

  const cards: Array<{
    key: string;
    label: string;
    value: number | undefined;
    icon: LucideIcon;
    tone: string;
  }> = [
    {
      key: 'total',
      label: t('total'),
      value: counts.data?.total,
      icon: UsersRound,
      tone: 'text-primary',
    },
    {
      key: 'registered',
      label: t('registered'),
      value: counts.data?.registered,
      icon: UserCheck,
      tone: 'text-success',
    },
    {
      key: 'pending',
      label: t('pending'),
      value: counts.data?.pending,
      icon: Clock3,
      tone: 'text-warning',
    },
    ...(managed.length > 0
      ? [
          {
            key: 'roles',
            label: t('roles'),
            value: holders.data,
            icon: ShieldCheck,
            tone: 'text-info',
          },
        ]
      : []),
  ];

  return (
    <ul
      aria-label={t('label')}
      className={cn(
        'm-0 grid list-none grid-cols-2 gap-3 p-0',
        cards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
      )}
    >
      {cards.map((card) => (
        <li
          key={card.key}
          className="grid gap-1 rounded-card border border-border bg-surface-1 p-4"
        >
          <span className="flex items-center justify-between gap-2 text-sm text-fg-muted">
            {card.label}
            <card.icon className={cn('size-4', card.tone)} aria-hidden />
          </span>
          {card.value === undefined ? (
            <Skeleton className="h-8 w-16" aria-busy />
          ) : (
            <span
              data-testid={`member-stat-${card.key}`}
              className={cn(
                'font-mono text-2xl font-bold [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]',
                card.key === 'registered' && 'text-success',
                card.key === 'pending' && 'text-warning',
              )}
            >
              {format.number(card.value, 'integer')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
