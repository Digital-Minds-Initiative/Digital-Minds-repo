'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactElement, type ReactNode } from 'react';
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { cn } from '@/client/lib/utils';
import { Label } from '@/components/ui/label';

/** Spread these onto the control so it is labelled and announces its errors. */
interface FieldControlProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
  'aria-required': boolean | undefined;
}

export interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: ReactNode;
  description?: ReactNode;
  required?: boolean;
  className?: string;
  render: (args: {
    field: ControllerRenderProps<TValues, TName>;
    fieldState: ControllerFieldState;
    controlProps: FieldControlProps;
  }) => ReactElement;
}

/**
 * Label + control + description + translated error, wired to React Hook Form.
 *
 *   <FormField control={form.control} name="fullName" label={t('fields.fullName')} required
 *     render={({ field, controlProps }) => <Input {...field} {...controlProps} />} />
 */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  required = false,
  className,
  render,
}: FormFieldProps<TValues, TName>) {
  const id = useId();
  const validationMessage = useValidationMessage();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const descriptionId = description ? `${id}-description` : undefined;
        const errorId = fieldState.error ? `${id}-error` : undefined;
        const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
        return (
          <div
            data-slot="form-field"
            data-invalid={fieldState.invalid || undefined}
            className={cn('grid gap-2', className)}
          >
            <Label htmlFor={id}>
              {label}
              {required ? (
                <span aria-hidden className="text-danger">
                  *
                </span>
              ) : null}
            </Label>
            {render({
              field,
              fieldState,
              controlProps: {
                id,
                'aria-invalid': fieldState.invalid || undefined,
                'aria-describedby': describedBy,
                'aria-required': required || undefined,
              },
            })}
            {description ? (
              <p id={descriptionId} data-slot="form-description" className="text-xs text-fg-muted">
                {description}
              </p>
            ) : null}
            {fieldState.error ? (
              <p id={errorId} data-slot="form-error" className="text-xs font-medium text-danger">
                {validationMessage(fieldState.error)}
              </p>
            ) : null}
          </div>
        );
      }}
    />
  );
}

/**
 * Translates a validation error. Contracts use message keys for custom rules (`date_in_future`);
 * built-in Zod checks are translated by issue code (`too_small`, `invalid_format`, …).
 */
function useValidationMessage(): (error: { type?: string; message?: string }) => string {
  const t = useTranslations('common.validation');
  type Key = Parameters<typeof t>[0];
  return (error) => {
    for (const candidate of [error.message, error.type]) {
      if (candidate && t.has(candidate as Key)) return t(candidate as Key);
    }
    return t('invalid');
  };
}
