import Image from 'next/image';

import { cn } from '@/client/lib/utils';

/**
 * A slow strip of the clubs on the platform — real marks where supplied, plain
 * names where not. Pure CSS loop, paused on hover/focus; reduced motion makes the
 * track a plain horizontally-scrollable row instead of animating.
 */
export interface MarqueeChip {
  name: string;
  /** The club's own supplied mark, shown unaltered beside its name. */
  logoSrc?: string;
  /** The file's real pixel size, so the mark keeps its proportions. */
  logoWidth?: number;
  logoHeight?: number;
}

export interface MarqueeProps {
  chips: MarqueeChip[];
  className?: string;
}

function Chip({ name, logoSrc, logoWidth = 96, logoHeight = 32 }: MarqueeChip) {
  return (
    <span
      dir="rtl"
      className="inline-flex h-14 items-center rounded-cell border border-paper-rule bg-paper-cream px-5 font-serif text-xl font-semibold whitespace-nowrap text-on-paper"
    >
      {logoSrc ? (
        <span className="inline-flex items-center gap-3">
          {/* The name is right beside it, so the mark itself is decorative. */}
          <Image
            src={logoSrc}
            alt=""
            width={logoWidth}
            height={logoHeight}
            className="block h-8 w-auto"
          />
          {name}
        </span>
      ) : (
        name
      )}
    </span>
  );
}

export function Marquee({ chips, className }: MarqueeProps) {
  return (
    <div
      tabIndex={0}
      dir="ltr"
      className={cn('overflow-hidden motion-reduce:overflow-x-auto', className)}
    >
      <div className="flex w-max animate-[marquee_var(--duration-marquee)_linear_infinite] gap-4 motion-reduce:animate-none [[tabindex]:focus-within_&]:[animation-play-state:paused] [[tabindex]:hover_&]:[animation-play-state:paused]">
        {[...chips, ...chips].map((chip, i) => (
          <Chip key={`${chip.name}-${i}`} {...chip} />
        ))}
      </div>
    </div>
  );
}
