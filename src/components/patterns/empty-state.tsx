import { cva, type VariantProps } from 'class-variance-authority';
import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const emptyStateVariants = cva('flex flex-col items-center justify-center gap-3 text-center', {
  variants: {
    variant: {
      /** Stand-alone section with a dashed frame. */
      framed: 'rounded-card border border-dashed border-border-strong px-6 py-12',
      /** Inside another container (e.g. a table body). */
      plain: 'px-4 py-6',
    },
  },
  defaultVariants: { variant: 'framed' },
});

export interface EmptyStateProps extends VariantProps<typeof emptyStateVariants> {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant,
  className,
}: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn(emptyStateVariants({ variant }), className)}>
      <div className="flex size-12 items-center justify-center rounded-cell bg-surface-3 text-fg-muted">
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="grid gap-1">
        <p className="text-base font-semibold text-fg">{title}</p>
        {description ? <p className="max-w-sm text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
