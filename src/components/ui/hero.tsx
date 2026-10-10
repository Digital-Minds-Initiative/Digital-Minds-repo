import type * as React from 'react';

import { cn } from '@/client/lib/utils';
import { SpecLabel } from '@/components/ui/spec-label';
import { Tower } from '@/components/ui/tower';

/**
 * The landing composition: a whispered spec line, a two-tone serif headline, one
 * sentence, one primary action plus a text link, and a Tower of real work beside
 * it. The system's first screen — one primary action, nothing overlaps the Tower.
 */
export interface HeroProps {
  specLine: string;
  headline: string;
  headlineMuted: string;
  body: string;
  primaryAction: React.ReactNode;
  secondaryLink: React.ReactNode;
  className?: string;
}

export function Hero({
  specLine,
  headline,
  headlineMuted,
  body,
  primaryAction,
  secondaryLink,
  className,
}: HeroProps) {
  return (
    <div
      className={cn('grid min-h-[560px] items-center gap-8 lg:grid-cols-[1fr_460px]', className)}
    >
      <div>
        <SpecLabel className="mb-8">{specLine}</SpecLabel>
        <h1 className="m-0 mb-8 font-serif text-[64px] leading-[72px] font-medium lg:text-[112px] lg:leading-[120px]">
          {headline} <em className="font-normal text-muted not-italic">{headlineMuted}</em>
        </h1>
        <p className="max-w-[440px] text-lg leading-8">{body}</p>
        <div className="mt-8 flex items-center gap-6">
          {primaryAction}
          {secondaryLink}
        </div>
      </div>
      <Tower height={520} cardWidth={300} cardHeight={190} className="hidden lg:block" />
    </div>
  );
}
