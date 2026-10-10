'use client';

import { useTranslations } from 'next-intl';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (removing a member, cancelling points). */
  variant?: 'default' | 'danger';
  /**
   * May return a promise: the button shows a spinner and the dialog stays open until it settles.
   * If it rejects, the dialog stays open — report the error yourself (e.g. with a toast).
   */
  onConfirm: () => void | Promise<void>;
}

/** Asks before a consequential action. Built on Radix AlertDialog (focus trapped, Esc cancels). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations('ui.confirmDialog');
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Stays open; the caller reports the error.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-backdrop data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <AlertDialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 top-1/2 z-50 mx-auto grid w-[calc(100%-2rem)] max-w-md -translate-y-1/2 gap-4 rounded-xl border border-border bg-overlay p-6 text-fg shadow-lg',
            'data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
          )}
        >
          <div className="grid gap-1.5">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              {title}
            </AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </AlertDialogPrimitive.Description>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel ?? t('cancel')}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              loading={pending}
              onClick={() => void confirm()}
            >
              {confirmLabel ?? t('confirm')}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
