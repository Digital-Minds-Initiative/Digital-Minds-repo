import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Text input. Mark it invalid with `aria-invalid` (FormField does this for you).
 * For emails and phone numbers pass `dir="ltr"` so they read correctly inside RTL forms.
 */
export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-surface-1 px-3 py-1 text-sm text-fg shadow-sm',
        'transition-colors outline-none placeholder:text-fg-subtle',
        'focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-danger aria-invalid:outline-danger/30',
        'file:me-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg',
        className,
      )}
      {...props}
    />
  );
}
