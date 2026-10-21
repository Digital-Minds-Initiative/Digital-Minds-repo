'use client';

import { DELAYS } from '@/components/motion/delays';
import { Reveal } from '@/components/motion/reveal';

import { MonthlyLeaderboard } from './monthly-leaderboard';
import {
  PointsLedger,
  usePointsLedger,
  type PointsLedgerLabels,
  type PointsLedgerRow,
} from './points-ledger';
import { SpecLabel } from './spec-label';

export interface PointsSystemProps {
  ledger: {
    sectionLabel: string;
    title: string;
    rows: PointsLedgerRow[];
    labels: PointsLedgerLabels;
  };
  board: {
    sectionLabel: string;
    title: string;
    panelLabel: string;
    /** Fixed totals, plus one entry (`linked`) that follows the ledger's balance. */
    entries: Array<{ id: string; label: string; points?: number; linked?: boolean }>;
  };
}

const headingClass =
  'font-serif text-[clamp(2rem,1.4rem+2.6vw,3.5rem)] leading-[1.25] font-medium text-balance';

/**
 * The points ledger and the monthly leaderboard as one demonstration: cancelling or restoring a
 * ledger entry changes one member's total, and the leaderboard re-ranks. Sample data only.
 */
export function PointsSystem({ ledger, board }: PointsSystemProps) {
  const state = usePointsLedger(ledger.rows);
  const entries = board.entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    points: entry.linked ? state.total : (entry.points ?? 0),
  }));

  return (
    <>
      <section className="px-4 py-12 sm:py-16 lg:py-24">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal
            variant="start"
            delay={2 * DELAYS.sectionStep}
            className="order-2 min-w-0 lg:order-1"
          >
            <PointsLedger rows={ledger.rows} labels={ledger.labels} state={state} />
          </Reveal>
          <div className="order-1 min-w-0 lg:order-2">
            <SpecLabel typed className="mb-4 block">
              {ledger.sectionLabel}
            </SpecLabel>
            <Reveal delay={DELAYS.sectionStep}>
              <h2 className={headingClass}>{ledger.title}</h2>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:py-16 lg:py-24">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SpecLabel typed className="mb-4 block">
              {board.sectionLabel}
            </SpecLabel>
            <Reveal delay={DELAYS.sectionStep}>
              <h2 className={headingClass}>{board.title}</h2>
            </Reveal>
          </div>
          <Reveal variant="end" delay={2 * DELAYS.sectionStep}>
            <MonthlyLeaderboard entries={entries} panelLabel={board.panelLabel} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
