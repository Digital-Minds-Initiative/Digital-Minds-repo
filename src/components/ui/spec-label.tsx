import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/**
 * Metadata set like an instrument panel: mono, upper-case Latin, an arrow, a code with
 * a subscript index, the rest separated by a middle dot. Always `dir="ltr"`, even
 * inside an RTL page — never put Arabic in a spec line itself.
 */
export interface SpecLabelProps extends React.ComponentProps<'span'> {
  arrow?: '→' | '↓' | '↗' | '·';
  index?: string;
  tone?: 'default' | 'on-deep' | 'on-hero';
}

export function SpecLabel({
  arrow,
  index,
  tone = 'default',
  className,
  children,
  ...props
}: SpecLabelProps) {
  return (
    <span
      dir="ltr"
      className={cn(
        'font-mono text-[11px] leading-4 font-medium tracking-[0.08em] uppercase [unicode-bidi:isolate]',
        tone === 'on-deep'
          ? 'text-on-deep-muted'
          : tone === 'on-hero'
            ? 'text-on-hero-muted'
            : 'text-muted',
        className,
      )}
      {...props}
    >
      {arrow}
      {index ? (
        <sub className="ms-px align-[-2px] text-[9px] tracking-[0.04em]">{index}</sub>
      ) : null}
      {arrow || index ? ' ' : null}
      {children}
    </span>
  );
}

function CornerTick({ className }: { className: string }) {
  return (
    <span className={cn('absolute size-[9px]', className)} aria-hidden>
      <span className="absolute start-1 top-0 h-[9px] w-px bg-on-deep-muted" />
      <span className="absolute start-0 top-1 h-px w-[9px] bg-on-deep-muted" />
    </span>
  );
}

/** The bordered spec panel variant: a deep block with corner crosshair ticks. */
export function SpecBlock({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('relative w-[260px] bg-deep p-4 text-on-deep-muted', className)} {...props}>
      <CornerTick className="-start-[5px] -top-[5px]" />
      <CornerTick className="-end-[5px] -top-[5px]" />
      <CornerTick className="-start-[5px] -bottom-[5px]" />
      <CornerTick className="-end-[5px] -bottom-[5px]" />
      {children}
    </div>
  );
}
