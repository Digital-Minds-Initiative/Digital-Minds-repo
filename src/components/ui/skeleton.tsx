import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/** Loading placeholder. Give it the size of the content it stands in for. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-surface-3', className)}
      {...props}
    />
  );
}
