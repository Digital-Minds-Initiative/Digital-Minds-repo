'use client';

import { useTranslations } from 'next-intl';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (removing a member, cancelling points). */
  variant?: 'default' | 'danger';
  /** Keeps the confirm button closed, e.g. while what it would act on is still loading. */
  confirmDisabled?: boolean;
  /**
   * May return a promise: the button shows a spinner and the dialog stays open until it settles.
   * If it rejects, the dialog stays open and shows the error — by its `reason` when there is one
   * (`club_not_empty`…), otherwise by its code.
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
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations('ui.confirmDialog');
  const errorText = useErrorText();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        onOpenChange(next);
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
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorText(error)}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel ?? t('cancel')}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              loading={pending}
              disabled={confirmDisabled}
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
