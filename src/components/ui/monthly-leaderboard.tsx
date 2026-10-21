'use client';

import { useRef, useState } from 'react';

import { cn } from '@/client/lib/utils';
import { DELAYS } from '@/components/motion/delays';
import { useInView } from '@/components/motion/use-in-view';

import { useTweenedNumber } from './use-tweened-number';

export interface LeaderboardEntry {
  id: string;
  /** An anonymous label such as `MEMBER 01` — never a real name. */
  label: string;
  points: number;
}

export interface MonthlyLeaderboardProps {
  entries: LeaderboardEntry[];
  /** For example `TOP · OCTOBER`. */
  panelLabel: string;
  className?: string;
}

const ROW_HEIGHT = 84;

/** Position of every entry, 0-based: most points first, ties keep the given order. */
function rankMap(entries: LeaderboardEntry[]): Record<string, number> {
  const sorted = entries
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => b.entry.points - a.entry.points || a.order - b.order);
  return Object.fromEntries(sorted.map(({ entry }, rank) => [entry.id, rank]));
}

const signature = (entries: LeaderboardEntry[]) =>
  entries.map((entry) => `${entry.id}:${entry.points}`).join('|');

/** Counts up from 0 once the board is on screen (`seen`), and follows the total after that. */
function Score({ points, seen }: { points: number; seen: boolean }) {
  const shown = useTweenedNumber(seen ? points : 0);
  return <>{shown}</>;
}

/**
 * Anonymous entries ranked by points. When a total changes the rows glide to their new positions,
 * the rank numbers swap, the totals count up or down and a row that moved glows briefly.
 */
export function MonthlyLeaderboard({ entries, panelLabel, className }: MonthlyLeaderboardProps) {
  const [seen, setSeen] = useState(entries);
  const [bumps, setBumps] = useState<Record<string, number>>({});
  const ranks = rankMap(entries);
  const board = useRef<HTMLDivElement>(null);
  const onScreen = useInView(board);

  // Compare with what was shown before (during render, so the glow starts with the new order).
  if (signature(seen) !== signature(entries)) {
    const before = rankMap(seen);
    setSeen(entries);
    setBumps((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        if (before[entry.id] !== ranks[entry.id]) next[entry.id] = (next[entry.id] ?? 0) + 1;
      }
      return next;
    });
  }

  return (
    <div
      ref={board}
      className={cn('rounded-card border border-border bg-surface-1 p-4 text-fg sm:p-6', className)}
    >
      <div className="mb-2 font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-fg-muted uppercase [direction:ltr]">
        {panelLabel}
      </div>
      <ul className="relative m-0 list-none p-0" style={{ height: entries.length * ROW_HEIGHT }}>
        {entries.map((entry) => {
          const rank = ranks[entry.id] ?? 0;
          const bump = bumps[entry.id] ?? 0;
          return (
            <li
              key={entry.id}
              className={cn(
                'absolute inset-x-0 top-0 flex items-center justify-between gap-4 border-b border-border px-2',
                'transition-transform duration-[650ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                rank === entries.length - 1 && 'border-b-0',
              )}
              style={{
                height: ROW_HEIGHT,
                transform: `translateY(${rank * ROW_HEIGHT}px)`,
                // Rows come in from the last place to the first, one after another.
                ...(seen
                  ? {
                      animation: `reveal-up 0.5s ease-out ${(entries.length - 1 - rank) * DELAYS.sectionStep}ms backwards`,
                    }
                  : { opacity: 0 }),
              }}
            >
              {bump > 0 ? (
                <span
                  key={bump}
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 inset-y-1.5 rounded-lg bg-primary/15 ring-1 ring-primary/50 motion-safe:animate-[rank-glow_1.3s_ease-out_both] motion-reduce:hidden"
                />
              ) : null}
              <span className="relative flex items-center gap-4 [direction:ltr]">
                <span
                  key={`${rank}-${bump}`}
                  className={cn(
                    'w-12 font-mono text-5xl leading-none font-bold [font-variant-numeric:lining-nums_tabular-nums]',
                    rank === 0 ? 'text-primary' : 'text-fg-muted',
                    bump > 0 && 'motion-safe:animate-[rank-swap_0.5s_ease-out_both]',
                    // First place pulses once as the board comes in.
                    seen &&
                      rank === 0 &&
                      bump === 0 &&
                      'motion-safe:animate-[rank-pulse_0.6s_ease-out_1s_backwards]',
                  )}
                >
                  {rank + 1}
                </span>
                <span className="font-mono text-[11px] tracking-[0.1em] text-fg-muted uppercase">
                  {entry.label}
                </span>
              </span>
              <span
                data-testid={`score-${entry.id}`}
                className="relative font-mono text-4xl leading-none font-bold [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]"
              >
                <Score points={entry.points} seen={onScreen} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
