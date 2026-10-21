'use client';

import { ShieldCheck, UsersRound, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { Me } from '@/shared/contracts/auth';

import { useMemberCount, useRoleHolderCount } from '../hooks/use-member-stats';

interface MemberStatsProps {
  access: Me['access'] | undefined;
  /** The club chosen in the filters, when one is; otherwise every club in the person's scope. */
  clubId: string | undefined;
}

/**
 * Two numbers above the filters: all members, and the people who hold a management role. The
 * second card is for people who manage a club — only they may read who holds the roles — and is
 * left out for everyone else.
 */
export function MemberStats({ access, clubId }: MemberStatsProps) {
  const t = useTranslations('members.stats');
  const format = useFormatter();
  const total = useMemberCount(clubId);
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
      value: total.data,
      icon: UsersRound,
      tone: 'text-primary',
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
      className={cn('m-0 grid list-none grid-cols-2 gap-3 p-0 sm:max-w-md')}
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
