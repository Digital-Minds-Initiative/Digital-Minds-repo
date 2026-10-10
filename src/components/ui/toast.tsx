'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Toast as ToastPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/client/lib/utils';

/*
 * Toast primitives (Radix Toast: announced to screen readers, F8 focuses the region, swipe to
 * dismiss). App code does not render these directly — call `toast()` from ./toaster.
 */

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'fixed end-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-none sm:max-w-sm',
        className,
      )}
      {...props}
    />
  );
}

export const toastVariants = cva(
  [
    'pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 pe-10 shadow-lg',
    'data-[state=closed]:animate-fade-out data-[state=open]:animate-pop-in data-[swipe=end]:animate-fade-out',
    'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
  ],
  {
    variants: {
      variant: {
        default: 'border-border bg-overlay text-fg',
        success: 'border-success/30 bg-success-subtle text-success-subtle-fg',
        danger: 'border-danger/30 bg-danger-subtle text-danger-subtle-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Toast({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
}

export function ToastTitle({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

export function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn('text-sm opacity-90', className)}
      {...props}
    />
  );
}

export function ToastClose({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
  const t = useTranslations('ui.toast');
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        'absolute end-2 top-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100',
        'outline-none focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      aria-label={t('close')}
      {...props}
    >
      <X className="size-4" aria-hidden />
    </ToastPrimitive.Close>
  );
}

export const ToastAction = ToastPrimitive.Action;
