'use client';

import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/** Supports `checked="indeterminate"` (used by DataTable's "select all"). */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer grid size-4 shrink-0 place-content-center rounded-sm border border-border-strong bg-surface-1 shadow-sm',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group grid place-content-center">
        <Check className="size-3.5 group-data-[state=indeterminate]:hidden" aria-hidden />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]:block" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
