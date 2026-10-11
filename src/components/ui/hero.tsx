import type * as React from 'react';

import type { SamplePage } from '@/client/lib/dm-engine';
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
  pages?: SamplePage[];
  tone?: 'default' | 'on-deep';
  className?: string;
}

export function Hero({
  specLine,
  headline,
  headlineMuted,
  body,
  primaryAction,
  secondaryLink,
  pages,
  tone = 'default',
  className,
}: HeroProps) {
  const onDeep = tone === 'on-deep';
  return (
    <div
      className={cn('grid min-h-[560px] items-center gap-8 lg:grid-cols-[1fr_460px]', className)}
    >
      <div>
        <SpecLabel tone={onDeep ? 'on-deep' : 'default'} className="mb-8">
          {specLine}
        </SpecLabel>
        <h1 className="m-0 mb-8 font-serif text-[64px] leading-[72px] font-medium lg:text-[112px] lg:leading-[120px]">
          {headline}{' '}
          <em
            className={cn('font-normal not-italic', onDeep ? 'text-on-deep-muted' : 'text-muted')}
          >
            {headlineMuted}
          </em>
        </h1>
        <p
          className={cn(
            'max-w-[440px] text-lg leading-8',
            onDeep ? 'text-on-deep-muted' : undefined,
          )}
        >
          {body}
        </p>
        <div className="mt-8 flex items-center gap-6">
          {primaryAction}
          {secondaryLink}
        </div>
      </div>
      <Tower
        pages={pages}
        height={520}
        cardWidth={300}
        cardHeight={190}
        className="hidden lg:block"
      />
    </div>
  );
}
