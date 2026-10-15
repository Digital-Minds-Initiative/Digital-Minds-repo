import { cn } from '@/client/lib/utils';
import { PixelSticker } from '@/components/ui/pixel-sticker';
import { DoodleStar, Tape } from '@/components/ui/scrapbook';

export interface MomentScrapProps {
  /** `MOMENT CAPTURED` */
  caption: string;
  /** A short Arabic line about the moment. */
  line: string;
  /** Marks the card as an illustration, for example `SAMPLE · 2026`. */
  date: string;
  className?: string;
}

/**
 * A miniature Polaroid: a pixel trophy in the "photo", a handwritten caption underneath and a line
 * of Arabic. Decorative storytelling — it stands for a recorded achievement and is not real data.
 */
export function MomentScrap({ caption, line, date, className }: MomentScrapProps) {
  return (
    <div
      className={cn(
        'relative rounded-[4px] border border-paper-rule bg-paper-cream px-2.5 pt-2.5 pb-3 text-on-paper',
        'drop-shadow-[0_6px_9px_color-mix(in_oklab,var(--slab)_38%,transparent)]',
        className,
      )}
    >
      <Tape tone="cream" className="start-1/2 -top-2.5 -ms-8 -rotate-[4deg]" />
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-paper-lilac">
        {/* A faint pixel grid, like the logo's cell grid. */}
        <span
          aria-hidden
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              'linear-gradient(var(--tuwaiq-lilac) 1px, transparent 1px), linear-gradient(90deg, var(--tuwaiq-lilac) 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }}
        />
        <PixelSticker name="trophy" className="relative w-[46%]" />
        <DoodleStar className="absolute end-2 top-2 size-4 rotate-12 text-club-orange" />
      </div>
      <p className="mt-2 mb-0 text-center font-(family-name:--font-hand) text-[21px] leading-none font-bold text-tuwaiq-indigo">
        {caption}
      </p>
      <p className="mt-1 mb-0 text-center font-serif text-[13px] leading-snug">{line}</p>
      <p className="mt-1 mb-0 text-center font-mono text-[9px] tracking-[0.1em] text-on-paper-muted uppercase [direction:ltr]">
        {date}
      </p>
    </div>
  );
}
