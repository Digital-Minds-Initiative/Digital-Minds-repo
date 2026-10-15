import { cva, type VariantProps } from 'class-variance-authority';

import { punchMarks } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * The system's unit of student work: a sheet of tractor-feed paper. A punched strip
 * runs down the inline-start edge, the body carries the code, title, tags and a
 * punch row of holes unique to the project (seeded, so it never changes between
 * renders). Tilt is at most `sheet-tilt` (4deg) — only one sheet in a group exceeds 3deg.
 */

export const paperSheetVariants = cva(
  'relative flex overflow-hidden rounded-cell border border-paper-rule text-on-paper',
  {
    variants: {
      tint: {
        cream: '[--sheet-p:var(--paper-cream)]',
        teal: '[--sheet-p:var(--paper-teal)]',
        peach: '[--sheet-p:var(--paper-peach)]',
        lilac: '[--sheet-p:var(--paper-lilac)]',
      },
    },
    defaultVariants: { tint: 'cream' },
  },
);

/** Tractor-feed punch holes on the inline-start edge. */
export function PunchRail({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-[26px] shrink-0 border-e border-dashed border-paper-rule bg-(--sheet-p)',
        className,
      )}
      style={{
        WebkitMask:
          'radial-gradient(circle at 13px 9px, transparent 4.2px, black 4.8px) 0 0/26px 18px repeat-y',
        mask: 'radial-gradient(circle at 13px 9px, transparent 4.2px, black 4.8px) 0 0/26px 18px repeat-y',
      }}
      aria-hidden
    />
  );
}

export interface PaperSheetProps extends VariantProps<typeof paperSheetVariants> {
  code: string;
  titleAr: string;
  titleEn: string;
  tags?: string[];
  /** Seeds the punch row so it stays identical between renders (e.g. code + titleEn). */
  seed?: string;
  tiltDeg?: number;
  width?: number;
  height?: number;
  className?: string;
}

export function PaperSheet({
  code,
  titleAr,
  titleEn,
  tags = [],
  seed,
  tint,
  tiltDeg = 0,
  width = 210,
  height = 290,
  className,
}: PaperSheetProps) {
  const marks = punchMarks(seed ?? `${code}${titleEn}`, 18, 2, 7);
  return (
    <div
      className={cn(paperSheetVariants({ tint }), className)}
      style={{
        width,
        minHeight: height,
        transform: `rotate(${tiltDeg}deg)`,
        background: 'var(--sheet-p)',
      }}
    >
      <PunchRail />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 bg-(--sheet-p) px-4 py-3.5">
        <span className="font-mono text-xs text-on-paper-muted" dir="ltr">
          {code}
        </span>
        <h3 className="font-serif text-[26px] leading-[38px] font-semibold text-balance">
          {titleAr}
        </h3>
        <span
          className="text-end font-mono text-[11px] leading-4 tracking-[0.04em] text-on-paper-muted"
          dir="ltr"
        >
          {titleEn}
        </span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[12px] leading-[18px] font-semibold">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-cell border border-paper-rule px-2 py-px not-italic"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <svg
          viewBox={`0 0 ${18 * 7} ${2 * 7}`}
          className="mt-auto h-3.5 w-full text-on-paper [direction:ltr]"
          aria-hidden
        >
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
    </div>
  );
}
