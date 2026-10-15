import type { ReactNode } from 'react';

import { cn } from '@/client/lib/utils';
import { paperSheetVariants, PunchRail, type PaperSheetProps } from '@/components/ui/paper-sheet';

export interface PaperFrameProps {
  children: ReactNode;
  tint?: PaperSheetProps['tint'];
  className?: string;
}

/** Faint paper grain under faint ruled lines; both are mixes of the paper's own ink colour. */
const PAPER_TEXTURE = [
  'radial-gradient(color-mix(in oklab, var(--color-on-paper) 7%, transparent) 0.5px, transparent 0.6px)',
  'repeating-linear-gradient(to bottom, transparent 0 31px, color-mix(in oklab, var(--color-on-paper) 7%, transparent) 31px 32px)',
].join(', ');

/**
 * A notebook page that can hold any content (sign-in forms, notices): cream paper with grain and
 * ruled lines, the punched binding on the inline-start edge, a lavender margin line and bookmark,
 * and the edges of the pages beneath peeking out. Height follows the content.
 */
export function PaperFrame({ children, tint = 'cream', className }: PaperFrameProps) {
  return (
    <div
      className={cn(
        paperSheetVariants({ tint }),
        'w-full max-w-[26rem] sm:max-w-[30rem] sm:-rotate-[0.25deg]',
        // In the dark theme the notebook turns night-blue: the paper, its ink and its ruling all
        // flip here, so every `on-paper` / `paper-rule` utility inside follows without changes.
        'dark:[--color-on-paper-muted:var(--on-deep-muted)] dark:[--color-on-paper:var(--on-deep)] dark:[--color-paper-rule:color-mix(in_oklab,var(--on-deep)_26%,transparent)] dark:[--sheet-p:var(--slab-2)]',
        // Two pages beneath, then a soft shadow on the dark surface.
        'shadow-[-3px_4px_0_-1px_var(--sheet-p),-3px_4px_0_0_var(--color-paper-rule),-6px_8px_0_-2px_var(--sheet-p),-6px_8px_0_-1px_var(--color-paper-rule),0_28px_48px_-24px_color-mix(in_oklab,var(--slab)_80%,transparent)]',
        className,
      )}
    >
      {/* The sheet itself has no fill: the binding's holes show the dark page through the paper. */}
      <PunchRail />
      <div
        className="relative flex min-w-0 flex-1 flex-col ps-7 pe-5 pt-6 pb-9 sm:ps-12 sm:pe-9 sm:pt-10 sm:pb-16"
        style={{
          backgroundColor: 'var(--sheet-p)',
          backgroundImage: PAPER_TEXTURE,
          backgroundSize: '6px 6px, auto',
        }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 start-4 w-px bg-tuwaiq-lilac/80 sm:start-6"
        />
        <span
          aria-hidden
          className="absolute end-6 top-0 h-12 w-7 bg-tuwaiq-lilac [clip-path:polygon(0_0,100%_0,100%_100%,50%_78%,0_100%)] sm:end-8 sm:h-16 sm:w-9"
        />
        {children}
      </div>
    </div>
  );
}
