import type * as React from 'react';

import type { SamplePage } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';
import { DELAYS } from '@/components/motion/delays';
import { SpecLabel } from '@/components/ui/spec-label';
import { Tower } from '@/components/ui/tower';

/**
 * The landing composition: a whispered spec line, a two-tone serif headline on two lines, one
 * sentence, optional actions, and an illustration beside it (`visual`, or a Tower of sample pages
 * when none is given). The system's first screen — nothing overlaps the illustration.
 */
export interface HeroProps {
  specLine: string;
  headline: string;
  headlineMuted: string;
  body: string;
  primaryAction?: React.ReactNode;
  secondaryLink?: React.ReactNode;
  /** The illustration beside the text. Without it the hero shows a Tower of `pages`. */
  visual?: React.ReactNode;
  pages?: SamplePage[];
  /** `on-hero` follows the theme (light lavender / deep purple); `on-deep` is always dark. */
  tone?: 'default' | 'on-deep' | 'on-hero';
  className?: string;
}

export function Hero({
  specLine,
  headline,
  headlineMuted,
  body,
  primaryAction,
  secondaryLink,
  visual,
  pages,
  tone = 'default',
  className,
}: HeroProps) {
  const onDeep = tone === 'on-deep';
  const onHero = tone === 'on-hero';
  return (
    <div
      className={cn(
        'grid items-center gap-12 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-14 xl:grid-cols-[minmax(0,1fr)_540px] xl:gap-20',
        className,
      )}
    >
      <div>
        <SpecLabel
          typed
          tone={onDeep ? 'on-deep' : onHero ? 'on-hero' : 'default'}
          className="mb-8 block w-fit sm:mb-12"
        >
          {specLine}
        </SpecLabel>
        <h1 className="m-0 mb-6 font-serif text-[clamp(2.75rem,1.9rem+5.2vw,6rem)] leading-[1.25] font-normal text-balance sm:mb-8">
          <span
            className="block motion-safe:animate-[rise_0.6s_ease-out_both]"
            style={{ animationDelay: `${DELAYS.heroText + DELAYS.heroTextStep}ms` }}
          >
            {headline}
          </span>
          <em
            style={{ animationDelay: `${DELAYS.heroText + 2 * DELAYS.heroTextStep}ms` }}
            className={cn(
              'block font-normal not-italic motion-safe:animate-[rise_0.6s_ease-out_both]',
              onDeep ? 'text-on-deep-muted' : onHero ? 'text-on-hero-muted' : 'text-muted',
            )}
          >
            {headlineMuted}
          </em>
        </h1>
        <p
          style={{ animationDelay: `${DELAYS.heroText + 3 * DELAYS.heroTextStep}ms` }}
          className={cn(
            'max-w-md text-base leading-8 motion-safe:animate-[rise_0.6s_ease-out_both] sm:text-lg',
            onDeep ? 'text-on-deep-muted' : onHero ? 'text-on-hero-muted' : undefined,
          )}
        >
          {body}
        </p>
        {primaryAction || secondaryLink ? (
          <div
            style={{ animationDelay: `${DELAYS.heroText + 4 * DELAYS.heroTextStep}ms` }}
            className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 motion-safe:animate-[rise_0.6s_ease-out_both] sm:mt-10"
          >
            {primaryAction}
            {secondaryLink}
          </div>
        ) : null}
      </div>
      {visual ? (
        <div className="mx-auto w-full max-w-md lg:max-w-none">{visual}</div>
      ) : (
        <Tower
          pages={pages}
          height="var(--hero-tower-h)"
          cardWidth={300}
          cardHeight={190}
          className="mx-auto w-full max-w-md [--hero-tower-h:320px] sm:[--hero-tower-h:400px] lg:max-w-none lg:[--hero-tower-h:520px]"
        />
      )}
    </div>
  );
}
