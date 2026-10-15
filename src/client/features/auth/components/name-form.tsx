'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { completeNameEndpoint } from '@/shared/contracts/auth';

import { paperButtonClass, paperInputClass } from './paper-classes';
import { useCompleteName } from '../hooks/use-sign-in';
import { routeSubmitError, type AuthDialogState } from '../lib/submit-error';

const schema = completeNameEndpoint.body;
type Input_ = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export interface NameFormProps {
  /** The name an admin stored for this email, to confirm or correct. Empty for a new person. */
  defaultFullName: string;
  onCompleted: () => void;
  /** The session ended while the form was open: start again from the email. */
  onSessionLost: () => void;
  onDialog: (dialog: AuthDialogState) => void;
}

export function NameForm({ defaultFullName, onCompleted, onSessionLost, onDialog }: NameFormProps) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('common.errors');
  const complete = useCompleteName();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Input_, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: defaultFullName },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await complete.mutateAsync(values);
      onCompleted();
    } catch (error) {
      const code = routeSubmitError(error, {
        setError: form.setError,
        fields: ['fullName'],
        onDialog,
      });
      if (code === 'UNAUTHENTICATED') onSessionLost();
      else if (code) setFormError(tErrors(code));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <FormField
        control={form.control}
        name="fullName"
        label={t('fields.fullName')}
        description={t('name.hint')}
        required
        className="gap-3"
        render={({ field, controlProps }) => (
          <Input
            {...field}
            {...controlProps}
            autoFocus
            autoComplete="name"
            className={paperInputClass}
          />
        )}
      />
      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" loading={complete.isPending} className={paperButtonClass}>
        {t('name.submit')}
      </Button>
    </form>
  );
}
