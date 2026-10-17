'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/**
 * A panel that slides in from the end edge (the left in Arabic) over the page: for looking at one
 * record without leaving the list it came from. Same behaviour as a Dialog — focus is trapped,
 * Esc and the overlay close it — so everything Radix gives a dialog applies.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const t = useTranslations('ui.dialog');
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-backdrop data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          // `end-0` is the left edge in RTL and the right edge in LTR.
          'fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col gap-4 overflow-y-auto border-s border-border bg-overlay p-5 text-fg shadow-lg sm:p-6',
          'data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in',
          'focus-visible:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute end-4 top-4 rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg',
            'outline-none focus-visible:outline-2 focus-visible:outline-ring',
          )}
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">{t('close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('grid gap-1 pe-8 text-start', className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-fg-muted', className)}
      {...props}
    />
  );
}
