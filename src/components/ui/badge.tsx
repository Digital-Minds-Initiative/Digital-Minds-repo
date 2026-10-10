import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-3 text-fg-muted',
        primary: 'bg-primary-subtle text-primary-subtle-fg',
        success: 'bg-success-subtle text-success-subtle-fg',
        warning: 'bg-warning-subtle text-warning-subtle-fg',
        danger: 'bg-danger-subtle text-danger-subtle-fg',
        info: 'bg-info-subtle text-info-subtle-fg',
        outline: 'border border-border-strong text-fg-muted',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
