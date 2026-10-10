import type * as React from 'react';

import { wordCells } from '@/lib/dm-engine';
import { cn } from '@/lib/utils';

/**
 * The 4:5 export people post to LinkedIn/stories: a `deep` field, perforated pixel
 * lettering, a registration grid, a spec block and fine grain — the system at full
 * volume. Shown at 40% scale here (432×540); exports at 1080×1350.
 */
export interface SharePosterProps {
  headline: string;
  caption: string;
  specDate: string;
  specProjectCode: string;
  specClub: string;
  clubLogoSrc?: string;
  className?: string;
}

const SCALE = 0.4;
const W = 1080 * SCALE;
const H = 1350 * SCALE;
const GRID_STEP = 96 * SCALE;

export function SharePoster({
  headline,
  caption,
  specDate,
  specProjectCode,
  specClub,
  clubLogoSrc,
  className,
}: SharePosterProps) {
  const digital = wordCells('DIGITAL', 7 * SCALE, 'perforated', 1.5);
  const minds = wordCells('MINDS', 7 * SCALE, 'perforated', 1.5);
  const gridLines: React.ReactNode[] = [];
  for (let x = 0; x <= W; x += GRID_STEP) {
    for (let y = 0; y <= H; y += GRID_STEP) {
      gridLines.push(
        <g key={`${x}-${y}`} opacity={0.25}>
          <line x1={x - 4} y1={y} x2={x + 4} y2={y} stroke="var(--on-deep)" strokeWidth={1} />
          <line x1={x} y1={y - 4} x2={x} y2={y + 4} stroke="var(--on-deep)" strokeWidth={1} />
        </g>,
      );
    }
  }

  return (
    <div
      className={cn('relative overflow-hidden bg-deep text-on-deep', className)}
      style={{ width: W, height: H }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0" aria-hidden>
        {gridLines}
        <g transform={`translate(${W * 0.1}, ${H * 0.52})`} className="fill-on-deep">
          {digital.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.s} height={c.s} rx={c.rx} fill="currentColor" />
          ))}
        </g>
        <g
          transform={`translate(${W * 0.1}, ${H * 0.58}) rotate(-5 ${W * 0.3} ${H * 0.14})`}
          className="fill-tuwaiq-lilac"
        >
          {minds.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.s} height={c.s} rx={c.rx} fill="currentColor" />
          ))}
        </g>
      </svg>

      <div className="absolute start-6 top-6 border border-on-deep/28 bg-deep/55 px-3 py-2.5">
        <div className="font-mono text-sm tracking-[0.04em] text-on-deep" dir="ltr">
          {specDate}
        </div>
        <div className="mt-1 font-mono text-[11px] text-on-deep-muted" dir="ltr">
          → {specProjectCode}
        </div>
        <div className="font-mono text-[11px] text-on-deep-muted" dir="ltr">
          {specClub}
        </div>
      </div>

      <div className="absolute end-7 text-end" style={{ top: H * 0.5 }}>
        <h2 className="m-0 text-[17.6px] leading-[22.4px] font-bold">{headline}</h2>
      </div>

      <div className="absolute start-6 bottom-[22px] flex items-center gap-2">
        {clubLogoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- fixed-size export asset, not content
          <img src={clubLogoSrc} alt="" className="h-11" />
        ) : null}
      </div>
      <div className="absolute end-6 bottom-[22px] text-end font-mono text-[11px] text-on-deep-muted">
        <div>{caption}</div>
        <div className="uppercase">SAMPLE · V4</div>
      </div>
    </div>
  );
}
