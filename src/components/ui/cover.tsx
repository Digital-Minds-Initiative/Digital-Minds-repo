import { punchMarks } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * The OG-image composition: an overlapping sheet stack behind a two-tone wordmark.
 * 960x320, matching the sheets' punch-row and dashed-tear-line language.
 */
export interface CoverProps {
  tagline: string;
  className?: string;
}

interface CoverSheet {
  fill: string;
  rotate: number;
  x: number;
  y: number;
  w: number;
  h: number;
  seed: string;
}

const SHEETS: CoverSheet[] = [
  { fill: 'var(--paper-teal)', rotate: -5, x: 520, y: 40, w: 220, h: 220, seed: 'a' },
  { fill: 'var(--paper-cream)', rotate: 3, x: 620, y: 70, w: 220, h: 220, seed: 'b' },
  { fill: 'var(--slab)', rotate: -1, x: 700, y: 30, w: 220, h: 220, seed: 'c' },
];

export function Cover({ tagline, className }: CoverProps) {
  return (
    <div className={cn('relative h-80 w-[960px] overflow-hidden bg-canvas', className)}>
      <svg viewBox="0 0 960 320" className="absolute inset-0 h-full w-full" aria-hidden>
        {SHEETS.map((sheet) => {
          const marks = punchMarks(sheet.seed, 3, 3, 4);
          return (
            <g
              key={sheet.seed}
              transform={`rotate(${sheet.rotate} ${sheet.x + sheet.w / 2} ${sheet.y + sheet.h / 2})`}
            >
              <rect x={sheet.x} y={sheet.y} width={sheet.w} height={sheet.h} fill={sheet.fill} />
              <line
                x1={sheet.x + 22}
                y1={sheet.y}
                x2={sheet.x + 22}
                y2={sheet.y + sheet.h}
                stroke="var(--paper-rule)"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
              />
              {Array.from({ length: 9 }, (_, i) => (
                <circle
                  key={i}
                  cx={sheet.x + 11}
                  cy={sheet.y + 10 + i * 20}
                  r={3.5}
                  fill="var(--canvas)"
                />
              ))}
              <text
                x={sheet.x + sheet.w - 10}
                y={sheet.y + 16}
                textAnchor="end"
                fontFamily="var(--font-mono)"
                fontSize={10}
              >
                {sheet.seed.toUpperCase()}1
              </text>
              <g transform={`translate(${sheet.x + sheet.w - 34}, ${sheet.y + sheet.h - 20})`}>
                {marks
                  .slice(0, 6)
                  .map((m, i) =>
                    m.kind === 'cell' ? (
                      <rect
                        key={i}
                        x={m.x}
                        y={m.y}
                        width={m.s}
                        height={m.s}
                        rx={1}
                        fill="var(--on-paper)"
                      />
                    ) : (
                      <circle
                        key={i}
                        cx={m.x + m.s / 2}
                        cy={m.y + m.s / 2}
                        r={m.s * 0.12}
                        fill="var(--on-paper)"
                        opacity={0.3}
                      />
                    ),
                  )}
              </g>
            </g>
          );
        })}
      </svg>
      <div className="absolute start-8 bottom-8 w-[480px]">
        <span className="font-mono text-xs tracking-[0.08em] text-muted uppercase" dir="ltr">
          DIGITAL MINDS · 1448
        </span>
        <h1 className="m-0 font-serif text-[88px] leading-[88px] font-medium text-ink">
          Digital
          <br />
          <em className="font-normal text-muted not-italic">Minds</em>
        </h1>
        <p className="text-sm leading-5 text-muted">{tagline}</p>
      </div>
    </div>
  );
}
