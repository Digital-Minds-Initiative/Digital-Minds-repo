'use client';

import { Coins, Trophy, UsersRound, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';

import type { RosterRow } from '../lib/roster';

interface KpiCardsProps {
  /** Null while the committee is still being read. */
  rows: readonly RosterRow[] | null;
}

/**
 * Three numbers about the chosen committee, above the filters: the points its members hold, how
 * many members it has, and the highest balance with who holds it. They come from the same list as
 * the table, so they always agree with it.
 */
export function KpiCards({ rows }: KpiCardsProps) {
  const t = useTranslations('points.screen.kpi');
  const format = useFormatter();

  const top =
    rows && rows.length > 0
      ? rows.reduce((best, row) => (row.balance > best.balance ? row : best))
      : null;
  const cards: Array<{
    key: string;
    label: string;
    value: string | null;
    hint?: string;
    icon: LucideIcon;
  }> = [
    {
      key: 'total',
      label: t('total'),
      value: rows
        ? format.number(
            rows.reduce((sum, row) => sum + row.balance, 0),
            'integer',
          )
        : null,
      icon: Coins,
    },
    {
      key: 'members',
      label: t('members'),
      value: rows ? format.number(rows.length, 'integer') : null,
      icon: UsersRound,
    },
    {
      key: 'top',
      label: t('top'),
      value: rows ? (top ? format.number(top.balance, 'integer') : '—') : null,
      hint: top?.fullName,
      icon: Trophy,
    },
  ];

  return (
    <ul aria-label={t('label')} className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-3">
      {cards.map((card) => (
        <li
          key={card.key}
          className="grid gap-1 rounded-card border border-border bg-surface-1 p-4"
        >
          <span className="flex items-center justify-between gap-2 text-sm text-fg-muted">
            {card.label}
            <card.icon className="size-4 text-primary" aria-hidden />
          </span>
          {card.value === null ? (
            <Skeleton className="h-8 w-20" aria-busy />
          ) : (
            <span
              data-testid={`kpi-${card.key}`}
              className="font-mono text-2xl font-bold [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]"
            >
              {card.value}
            </span>
          )}
          <span className="min-h-4 truncate text-xs text-fg-subtle">{card.hint ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}
