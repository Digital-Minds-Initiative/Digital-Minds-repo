import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot as SlotPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/client/lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap',
    'transition-colors outline-none select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  ],
  {
    variants: {
      variant: {
        primary: 'border border-primary bg-primary text-primary-fg hover:bg-primary-hover',
        secondary: 'border border-border-strong bg-transparent text-fg hover:bg-surface-2',
        outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-2',
        ghost: 'border border-transparent text-fg hover:bg-surface-3',
        danger: 'border border-danger bg-transparent text-danger hover:bg-danger-subtle',
        link: 'border border-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-11 px-5',
        lg: 'h-12 px-6 text-base',
        icon: 'size-11',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Link) with button styles instead of a <button>. */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <SlotPrimitive.Slot
        data-slot="button"
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </SlotPrimitive.Slot>
    );
  }
  return (
    <button
      data-slot="button"
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
