import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/client/lib/utils';

/*
 * The paper desk's materials: a sheet with an optional torn edge or folded corner, strips of washi
 * tape, and a few hand-drawn doodles. All colours are brand tokens. Everything here is decorative
 * and server-renderable; the notes that use it add their own interaction.
 */

export type PaperTint = 'lilac' | 'peach' | 'teal' | 'cream';

const TINTS: Record<PaperTint, string> = {
  lilac: '[--paper:var(--paper-lilac)]',
  peach: '[--paper:var(--paper-peach)]',
  teal: '[--paper:var(--paper-teal)]',
  cream: '[--paper:var(--paper-cream)]',
};

/** Ragged edges, as clip-paths in percentages so they fit a sheet of any size. */
const TORN = {
  bottom:
    'polygon(0 0,100% 0,100% 95%,95% 98%,90% 94.5%,84% 98.5%,78% 95%,72% 99%,66% 95.5%,59% 98%,53% 94%,47% 97.5%,41% 95%,34% 99%,28% 96%,21% 98.5%,15% 94.5%,9% 97.5%,4% 95%,0 98%)',
  top: 'polygon(0 2%,4% 5%,9% 2.5%,15% 5.5%,21% 1.5%,28% 4%,34% 1%,41% 5%,47% 2.5%,53% 6%,59% 2%,66% 4.5%,72% 1%,78% 5%,84% 1.5%,90% 5.5%,95% 2%,100% 5%,100% 100%,0 100%)',
  right:
    'polygon(0 0,95% 0,98% 6%,94.5% 12%,98.5% 19%,95% 26%,99% 33%,95.5% 40%,98% 47%,94% 54%,97.5% 61%,95% 68%,99% 75%,96% 82%,98.5% 89%,94.5% 95%,97% 100%,0 100%)',
} as const;
const FOLD = 22;
const FOLDED = `polygon(0 0,100% 0,100% calc(100% - ${FOLD}px),calc(100% - ${FOLD}px) 100%,0 100%)`;

/** Faint paper grain; a mix of the ink colour, so it works on every tint. */
const GRAIN =
  'radial-gradient(color-mix(in oklab, var(--on-paper) 7%, transparent) 0.5px, transparent 0.6px)';

export interface ScrapPaperProps {
  tint?: PaperTint;
  /** Which edge is torn; leave out for a clean sheet. */
  torn?: keyof typeof TORN;
  /** Fold the bottom-right corner over. */
  fold?: boolean;
  className?: string;
  children?: ReactNode;
}

/** A sheet: grain, a soft shadow that follows its (torn) outline, and room for tape on top. */
export function ScrapPaper({ tint = 'cream', torn, fold, className, children }: ScrapPaperProps) {
  const clipPath = torn ? TORN[torn] : fold ? FOLDED : undefined;
  return (
    <div
      className={cn(
        'relative text-on-paper',
        'drop-shadow-[0_6px_9px_color-mix(in_oklab,var(--slab)_38%,transparent)]',
        TINTS[tint],
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 bg-(--paper)',
          !torn && 'rounded-cell border border-paper-rule',
        )}
        style={{ clipPath, backgroundImage: GRAIN, backgroundSize: '6px 6px' }}
      />
      <div className="relative">{children}</div>
      {fold ? (
        <span
          aria-hidden
          className="absolute bottom-0 block"
          style={{
            // Physical on purpose: the clip-path cuts the physical bottom-right corner.
            right: 0,
            width: FOLD,
            height: FOLD,
            // The flap that was folded over: the paper's own colour, a little darker.
            background: `linear-gradient(135deg, color-mix(in oklab, var(--paper) 78%, var(--slab)) 50%, transparent 50%)`,
          }}
        />
      ) : null}
    </div>
  );
}

const TAPE_TONES = {
  lilac: 'bg-tuwaiq-lilac',
  purple: 'bg-tuwaiq-indigo',
  teal: 'bg-tuwaiq-teal',
  cream: 'bg-paper-cream',
} as const;

export type TapeTone = keyof typeof TAPE_TONES;

/** A strip of washi tape with notched ends and faint stripes. Position and tilt come from className. */
export function Tape({ tone = 'lilac', className }: { tone?: TapeTone; className?: string }) {
  return (
    <span
      aria-hidden
      data-tape
      className={cn('absolute z-20 block h-5 w-16 opacity-85', TAPE_TONES[tone], className)}
      style={
        {
          clipPath:
            'polygon(0 0,100% 0,97% 20%,100% 40%,97% 60%,100% 80%,97% 100%,0 100%,3% 80%,0 60%,3% 40%,0 20%)',
          backgroundImage:
            'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, var(--paper-cream) 28%, transparent) 5px 7px)',
        } satisfies CSSProperties
      }
    />
  );
}

interface DoodleProps {
  className?: string;
}

function Doodle({ className, children }: DoodleProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('block size-6', className)}
    >
      {children}
    </svg>
  );
}

/** A sketchy five-point star. */
export function DoodleStar({ className }: DoodleProps) {
  return (
    <Doodle className={className}>
      <path d="M12 3.2 14.5 9.3 21 9.8 16 14.1 17.6 20.6 11.9 17.2 6.4 20.4 8 14 3.1 9.6 9.5 9.2Z" />
    </Doodle>
  );
}

/** A looping arrow that points somewhere with some attitude. */
export function DoodleArrow({ className }: DoodleProps) {
  return (
    <Doodle className={className}>
      <path d="M3 19C6 7 13 5 20 11" />
      <path d="M15.2 7.6 20.6 11.3 16.4 16" />
    </Doodle>
  );
}

export function DoodleCheck({ className }: DoodleProps) {
  return (
    <Doodle className={className}>
      <path d="M4 12.8 9.6 18.4 20 5.6" />
    </Doodle>
  );
}

export function DoodleCross({ className }: DoodleProps) {
  return (
    <Doodle className={className}>
      <path d="M5.2 5 18.8 19.2M19 4.6 5 19" />
    </Doodle>
  );
}

/** A wavy pencil underline, wider than it is tall. */
export function DoodleSquiggle({ className }: DoodleProps) {
  return (
    <svg
      viewBox="0 0 60 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      className={cn('block h-2 w-14', className)}
    >
      <path d="M2 5C6 1 9 1 13 5S20 8 24 4 31 1 35 5 42 8 46 4 53 2 58 5" />
    </svg>
  );
}
