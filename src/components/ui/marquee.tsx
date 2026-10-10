import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * A slow strip of the clubs on the platform — real marks where supplied, plain
 * names where not. Pure CSS loop, paused on hover/focus; reduced motion makes the
 * track a plain horizontally-scrollable row instead of animating.
 */
export interface MarqueeChip {
  name: string;
  logoSrc?: string;
}

export interface MarqueeProps {
  chips: MarqueeChip[];
  className?: string;
}

function Chip({ name, logoSrc }: MarqueeChip) {
  return (
    <span
      dir="rtl"
      className="inline-flex h-14 items-center rounded-cell border border-paper-rule bg-paper-cream px-5 font-serif text-xl font-semibold whitespace-nowrap text-on-paper"
    >
      {logoSrc ? (
        <Image src={logoSrc} alt={name} height={32} width={96} className="block h-8 w-auto" />
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
