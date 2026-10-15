import { cn } from '@/client/lib/utils';
import {
  DoodleStar,
  ScrapPaper,
  Tape,
  type PaperTint,
  type TapeTone,
} from '@/components/ui/scrapbook';

export interface ScrapLabelProps {
  text: string;
  tint?: PaperTint;
  /** A ragged right edge, as if torn off a bigger sheet. */
  torn?: boolean;
  /** A folded bottom corner. */
  fold?: boolean;
  tape?: TapeTone;
  /** A tiny star doodle at the end. */
  star?: boolean;
  className?: string;
}

/** A small scrap of paper with a mono label: `IDEA #024`, `DRAFT 01`, `KEEP THIS`. */
export function ScrapLabel({
  text,
  tint = 'cream',
  torn,
  fold,
  tape,
  star,
  className,
}: ScrapLabelProps) {
  return (
    <ScrapPaper tint={tint} torn={torn ? 'right' : undefined} fold={fold} className={className}>
      {tape ? <Tape tone={tape} className="start-3 -top-2 h-4 w-12 -rotate-6" /> : null}
      <span
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 font-mono text-[12px] font-medium tracking-[0.1em] uppercase [direction:ltr]',
          torn && 'pe-5',
        )}
      >
        {text}
        {star ? <DoodleStar className="size-3.5 text-club-orange" /> : null}
      </span>
    </ScrapPaper>
  );
}
