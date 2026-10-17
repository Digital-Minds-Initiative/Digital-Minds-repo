'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { idSchema } from '@/shared/contracts/core';
import {
  POINTS_AMOUNT_LIMIT,
  POINTS_REASON_MAX,
  workDateSchema,
  type CreatePointTransactionBody,
  type PointTransaction,
  type UpdatePointTransactionBody,
} from '@/shared/contracts/points';
import { toLatinDigits } from '@/shared/lib/arabic';
import { todayInAppTimeZone } from '@/shared/lib/dates';
import { collapseWhitespace } from '@/shared/lib/text';

type PointsFormMode =
  | {
      type: 'add';
      memberName: string;
      /** Committees the person may record points in for this member. */
      committees: ReadonlyArray<{ id: string; name: string }>;
      onSubmit: (committeeId: string, body: CreatePointTransactionBody) => Promise<unknown>;
    }
  | {
      type: 'edit';
      transaction: PointTransaction;
      /** Only the fields that changed. */
      onSubmit: (body: UpdatePointTransactionBody) => Promise<unknown>;
    };

export interface PointsFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PointsFormMode;
}

const FIELDS = ['committeeId', 'amount', 'reason', 'workDate'] as const;

/**
 * Digits only (Arabic-Indic ones are accepted), 1 to the limit. It stays a string — the form's
 * input and output types must match — and is turned into a number when the request is built.
 */
const amountFieldSchema = z
  .string()
  .transform((value) => toLatinDigits(value.trim()))
  .pipe(z.string().regex(/^\d+$/, { message: 'invalid_format' }))
  .superRefine((value, ctx) => {
    const amount = Number(value);
    if (amount < 1)
      ctx.addIssue({ code: 'too_small', origin: 'number', minimum: 1, inclusive: true });
    if (amount > POINTS_AMOUNT_LIMIT) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: POINTS_AMOUNT_LIMIT,
        inclusive: true,
      });
    }
  });

const formSchema = z.object({
  committeeId: z.string(),
  kind: z.enum(['add', 'deduct']),
  amount: amountFieldSchema,
  // The contract's rule, with the "required" wording for an empty reason.
  reason: z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().min(1, { message: 'invalid_type' }).max(POINTS_REASON_MAX)),
  workDate: workDateSchema,
});

/**
 * One form to record points and to correct a recorded transaction. The person types a positive
 * number and picks add or deduct, so a deduction is never a minus sign typed by mistake; the sign
 * is applied when the request is built. When editing, only what changed is sent.
 */
export function PointsFormDialog(props: PointsFormDialogProps) {
  // Mounted only while open, so every opening starts from the transaction's current values.
  return props.open ? <PointsForm {...props} /> : null;
}

function PointsForm({ onOpenChange, mode }: PointsFormDialogProps) {
  const t = useTranslations('points.form');
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const editing = mode.type === 'edit' ? mode.transaction : null;
  const today = useMemo(() => todayInAppTimeZone(), []);
  const onlyCommittee =
    mode.type === 'add' && mode.committees.length === 1 ? mode.committees[0] : null;

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      committeeId: onlyCommittee?.id ?? '',
      kind: editing && editing.amount < 0 ? 'deduct' : 'add',
      amount: editing ? String(Math.abs(editing.amount)) : '',
      reason: editing?.reason ?? '',
      workDate: editing?.workDate ?? today,
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (mode.type === 'add' && !idSchema.safeParse(values.committeeId).success) {
      form.setError('committeeId', { type: 'invalid_type', message: 'invalid_type' });
      return;
    }
    const magnitude = Number(values.amount);
    const amount = values.kind === 'deduct' ? -magnitude : magnitude;
    try {
      if (mode.type === 'add') {
        await mode.onSubmit(values.committeeId, {
          amount,
          reason: values.reason,
          workDate: values.workDate,
        });
      } else {
        const current = mode.transaction;
        const changes: UpdatePointTransactionBody = {
          ...(amount !== current.amount ? { amount } : {}),
          ...(collapseWhitespace(values.reason) !== current.reason
            ? { reason: values.reason }
            : {}),
          ...(values.workDate !== current.workDate ? { workDate: values.workDate } : {}),
        };
        if (Object.keys(changes).length === 0) {
          setFormError(t('noChanges'));
          return;
        }
        await mode.onSubmit(changes);
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const issue = error.details.issues?.find((candidate) =>
          (FIELDS as readonly string[]).includes(String(candidate.path.at(-1))),
        );
        if (issue) {
          form.setError(issue.path.at(-1) as (typeof FIELDS)[number], {
            type: issue.code,
            message: issue.code,
          });
          return;
        }
      }
      setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    // A double click arrives before the button shows as busy: one request is enough, or the same
    // points would be recorded twice.
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
          <DialogTitle>{mode.type === 'add' ? t('addTitle') : t('editTitle')}</DialogTitle>
          <DialogDescription>
            {mode.type === 'add'
              ? t('addDescription', { name: mode.memberName })
              : t('editDescription')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          {mode.type === 'add' ? (
            <FormField
              control={form.control}
              name="committeeId"
              label={t('fields.committee')}
              required
              render={({ field, controlProps }) =>
                onlyCommittee ? (
                  <p className="text-sm font-medium">{onlyCommittee.name}</p>
                ) : (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={controlProps.id} aria-invalid={controlProps['aria-invalid']}>
                      <SelectValue placeholder={t('fields.committeePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {mode.committees.map((committee) => (
                        <SelectItem key={committee.id} value={committee.id}>
                          {committee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            />
          ) : (
            <p className="text-sm text-fg-muted">{mode.transaction.committee.name}</p>
          )}

          <FormField
            control={form.control}
            name="kind"
            label={t('kind')}
            render={({ field }) => (
              <div role="group" aria-label={t('kind')} className="grid grid-cols-2 gap-2">
                {(['add', 'deduct'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={field.value === kind}
                    onClick={() => field.onChange(kind)}
                    className={cn(
                      'h-11 cursor-pointer rounded-md border text-sm font-semibold transition-colors',
                      'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                      field.value === kind
                        ? kind === 'add'
                          ? 'border-success bg-success-subtle text-success-subtle-fg'
                          : 'border-danger bg-danger-subtle text-danger-subtle-fg'
                        : 'border-border-strong bg-transparent text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    {t(`kinds.${kind}`)}
                  </button>
                ))}
              </div>
            )}
          />

          <FormField
            control={form.control}
            name="amount"
            label={t('fields.amount')}
            description={t('fields.amountHint')}
            required
            render={({ field, controlProps }) => (
              <Input
                {...field}
                {...controlProps}
                inputMode="numeric"
                dir="ltr"
                autoComplete="off"
                autoFocus
              />
            )}
          />
          <FormField
            control={form.control}
            name="reason"
            label={t('fields.reason')}
            description={t('fields.reasonHint')}
            required
            render={({ field, controlProps }) => (
              <textarea
                {...field}
                {...controlProps}
                rows={3}
                maxLength={POINTS_REASON_MAX * 2}
                className="min-h-20 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-fg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-danger"
              />
            )}
          />
          <FormField
            control={form.control}
            name="workDate"
            label={t('fields.workDate')}
            description={t('fields.workDateHint')}
            required
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} type="date" max={today} dir="ltr" />
            )}
          />

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {mode.type === 'add' ? t('submitAdd') : t('submitEdit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
