'use client';

import { useEffect, useRef } from 'react';

import {
  attachTower,
  punchMarks,
  SAMPLE_PAGES,
  type SamplePage,
  type TowerHandle,
} from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * Project pages receding in depth, one behind the next, idle-drifting forward until
 * the front page falls away and the back one rises — shows volume of work without a
 * grid. Wheel, arrow keys and pointer tilt (up to 8deg) move through it. Only the
 * nearest page receives clicks and is read by screen readers; everything stops under
 * `prefers-reduced-motion`.
 */
export interface TowerProps {
  pages?: SamplePage[];
  className?: string;
  /** Pixels, or any CSS length (for example a variable a breakpoint class sets). */
  height?: number | string;
  cardWidth?: number;
  cardHeight?: number;
  onHandle?: (handle: TowerHandle) => void;
}

function PageCard({ page, width, height }: { page: SamplePage; width: number; height: number }) {
  const marks = punchMarks(page.code + page.title, 26, 2, 7);
  return (
    <div
      data-tower-card
      className="absolute inset-x-0 top-1/2 mx-auto flex flex-col justify-between rounded-cell border border-paper-rule p-4 px-5"
      style={{
        // Never wider than the stage, so narrow screens keep the card whole.
        width: `min(${width}px, 88%)`,
        height,
        marginTop: -height / 2,
        background: page.bg,
        color: page.fg,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] uppercase [unicode-bidi:isolate]">
          {page.code} · SAMPLE
        </span>
        <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] uppercase [unicode-bidi:isolate]">
          1448
        </span>
      </div>
      <h4 className="m-0 font-serif text-[30px] leading-[42px] font-semibold">{page.title}</h4>
      <svg viewBox="0 0 182 14" className="h-3.5 w-[182px] [direction:ltr]" aria-hidden>
        {marks.map((m, i) =>
          m.kind === 'cell' ? (
            <rect key={i} x={m.x} y={m.y} width={m.s} height={m.s} rx={1} fill="currentColor" />
          ) : (
            <circle
              key={i}
              cx={m.x + m.s / 2}
              cy={m.y + m.s / 2}
              r={m.s * 0.12}
              fill="currentColor"
              opacity={0.3}
            />
          ),
        )}
      </svg>
    </div>
  );
}

export function Tower({
  pages = SAMPLE_PAGES,
  className,
  height = 440,
  cardWidth = 340,
  cardHeight = 214,
  onHandle,
}: TowerProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handle = attachTower(stage, { stepY: -42, stepZ: -140, depth: 7 });
    handle.set(0.001);
    onHandle?.(handle);
    return () => handle.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onHandle is a ref-like callback, not state
  }, []);

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      className={cn(
        'relative overflow-hidden rounded-cell bg-surface-sunken perspective-(--perspective-tower)',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        className,
      )}
      style={{ height }}
    >
      <div
        data-tower
        className="absolute inset-x-0 top-[18%] h-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(calc(var(--tilt-tower) + var(--rx, 0deg))) rotateY(var(--ry, 0deg))',
        }}
      >
        {pages.map((page) => (
          <PageCard key={page.code} page={page} width={cardWidth} height={cardHeight} />
        ))}
      </div>
    </div>
  );
}
