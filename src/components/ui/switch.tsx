'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/**
 * An on/off control for a setting that applies at once (show archived, for example). Unlike a
 * checkbox it is not part of a form that gets submitted. The thumb slides toward the end of the
 * track in both directions of text, so it reads the same in Arabic and in English.
 */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong transition-colors',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-fg shadow-sm transition-transform',
          // Logical offsets: off sits at the start edge, on moves to the end edge.
          'ms-0.5 data-[state=checked]:translate-x-0 ltr:data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
