'use client';

import { useState } from 'react';

import { cn } from '@/client/lib/utils';

import { useTweenedNumber } from './use-tweened-number';

/**
 * A small points ledger you can play with: every row is a paper entry you press to cancel (it stays
 * in the list, struck through and faded, and leaves the balance) and press again to restore. The
 * balance counts to its new value and a short +/− note floats up. Shows how the real ledger
 * behaves — nothing is deleted.
 */
export interface PointsLedgerRow {
  id: string;
  /** Work date, `YYYY-MM-DD`. */
  date: string;
  reason: string;
  points: number;
  /** Starts cancelled. */
  voided?: boolean;
}

export interface PointsLedgerLabels {
  balance: string;
  date: string;
  reason: string;
  points: string;
  /** Tag on a cancelled row, for example `VOID`. */
  cancelled: string;
}

const sign = (value: number) => (value < 0 ? '−' : '+');

/** The ledger's state, so another demo (the leaderboard) can follow the same balance. */
export function usePointsLedger(rows: PointsLedgerRow[]) {
  const [cancelled, setCancelled] = useState(
    () => new Set(rows.filter((row) => row.voided).map((row) => row.id)),
  );
  const [pulse, setPulse] = useState<{ id: number; text: string; gain: boolean } | null>(null);
  const total = rows.reduce((sum, row) => sum + (cancelled.has(row.id) ? 0 : row.points), 0);

  function toggle(row: PointsLedgerRow) {
    const wasCancelled = cancelled.has(row.id);
    setCancelled((previous) => {
      const next = new Set(previous);
      if (wasCancelled) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
    // Restoring a row adds its points back; cancelling takes them off.
    const change = wasCancelled ? row.points : -row.points;
    setPulse({
      id: (pulse?.id ?? 0) + 1,
      text: `${sign(change)}${Math.abs(change)}`,
      gain: change > 0,
    });
  }

  return { cancelled, pulse, total, toggle };
}

export interface PointsLedgerProps {
  rows: PointsLedgerRow[];
  labels: PointsLedgerLabels;
  /** Pass the result of `usePointsLedger` to share the state; otherwise the ledger keeps its own. */
  state?: ReturnType<typeof usePointsLedger>;
  className?: string;
}

const ROW_COLUMNS =
  'grid-cols-[1.25rem_4.75rem_1fr_3rem] gap-x-3 sm:grid-cols-[1.25rem_6rem_1fr_3.5rem] sm:gap-x-5';

export function PointsLedger({ rows, labels, state, className }: PointsLedgerProps) {
  const own = usePointsLedger(rows);
  const { cancelled, pulse, total, toggle } = state ?? own;
  const balance = useTweenedNumber(total);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-card border border-border bg-surface-1 p-4 text-fg sm:p-5',
        className,
      )}
    >
      <div className="flex items-end justify-between gap-4 border-b border-border pb-3.5">
        <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-fg-muted uppercase [direction:ltr] [unicode-bidi:isolate]">
          {labels.balance}
        </span>
        <span className="flex items-baseline gap-2.5 [direction:ltr]">
          <span
            data-testid="ledger-balance"
            className="font-mono text-[2.75rem] leading-none font-bold [font-variant-numeric:lining-nums_tabular-nums]"
          >
            {balance}
          </span>
          {pulse ? (
            <span
              key={pulse.id}
              aria-hidden
              className={cn(
                'font-mono text-base font-medium motion-safe:animate-[ledger-pop_1s_ease-out_forwards] motion-reduce:hidden',
                pulse.gain ? 'text-success' : 'text-danger',
              )}
            >
              {pulse.text}
            </span>
          ) : null}
        </span>
      </div>

      <div aria-hidden className={cn('grid px-3 py-2 text-[12px] text-fg-muted', ROW_COLUMNS)}>
        <span />
        <span>{labels.date}</span>
        <span>{labels.reason}</span>
        <span className="text-end">{labels.points}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const isCancelled = cancelled.has(row.id);
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={isCancelled}
                onClick={() => toggle(row)}
                className={cn(
                  'grid w-full cursor-pointer items-center rounded-lg border border-border bg-surface-2 px-3 py-3 text-start text-[15px] text-fg',
                  ROW_COLUMNS,
                  'transition-[background-color,border-color,opacity,transform] duration-(--duration-base) ease-out motion-reduce:transition-none',
                  'hover:-translate-y-px hover:border-primary hover:bg-surface-3 active:translate-y-0 motion-reduce:hover:translate-y-0',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                  isCancelled && 'border-dashed opacity-55',
                )}
              >
                {/* A tick circle that shows the entry's state: ticked = counts, crossed = cancelled. */}
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border-2 transition-colors duration-(--duration-base)',
                    isCancelled
                      ? 'border-fg-muted text-fg-muted'
                      : 'border-primary bg-primary text-surface-1',
                  )}
                >
                  <svg viewBox="0 0 12 12" className="size-3" fill="none">
                    <path
                      d={isCancelled ? 'M3 3l6 6M9 3l-6 6' : 'M2.5 6.5l2.2 2.2L9.5 3.5'}
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="font-mono text-[13px] text-fg-muted [direction:ltr] [unicode-bidi:isolate]">
                  {row.date}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'transition-colors duration-(--duration-base)',
                      isCancelled && 'text-fg-muted line-through decoration-2',
                    )}
                  >
                    {row.reason}
                  </span>
                  {isCancelled ? (
                    <span className="rounded-sm border border-fg-muted/60 px-1.5 font-mono text-[10px] leading-4 tracking-[0.1em] text-fg-muted uppercase [direction:ltr]">
                      {labels.cancelled}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    'text-end font-mono font-semibold transition-colors duration-(--duration-base) [direction:ltr] [unicode-bidi:isolate]',
                    isCancelled
                      ? 'text-fg-muted line-through'
                      : row.points < 0
                        ? 'text-danger'
                        : 'text-success',
                  )}
                >
                  {sign(row.points)}
                  {Math.abs(row.points)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
