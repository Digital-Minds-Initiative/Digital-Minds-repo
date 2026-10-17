'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { POINTS_REASON_MAX } from '@/shared/contracts/points';
import { collapseWhitespace } from '@/shared/lib/text';

// The contract's rule, with the "required" wording for an empty reason.
const schema = z.object({
  reason: z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().min(1, { message: 'invalid_type' }).max(POINTS_REASON_MAX)),
});

export interface CancelPointsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<unknown>;
}

/**
 * Cancelling asks for a reason, which is stored with the person who cancelled and when. It is
 * final — the transaction stays in the history as cancelled and never comes back — so the dialog
 * says so before the button.
 */
export function CancelPointsDialog(props: CancelPointsDialogProps) {
  return props.open ? <CancelForm {...props} /> : null;
}

function CancelForm({ onOpenChange, onConfirm }: CancelPointsDialogProps) {
  const t = useTranslations('points.cancelDialog');
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onConfirm(values.reason);
      onOpenChange(false);
    } catch (error) {
      const issue =
        error instanceof ApiError
          ? error.details.issues?.find((candidate) => candidate.path.at(-1) === 'reason')
          : undefined;
      if (issue) form.setError('reason', { type: issue.code, message: issue.code });
      else setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    void submit(event).finally(() => {
      busyRef.current = false;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!form.formState.isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="reason"
            label={t('reason')}
            description={t('reasonHint')}
            required
            render={({ field, controlProps }) => (
              <textarea
                {...field}
                {...controlProps}
                rows={3}
                autoFocus
                className="min-h-20 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-fg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-danger"
              />
            )}
          />
          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('keep')}
            </Button>
            <Button type="submit" variant="danger" loading={form.formState.isSubmitting}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
