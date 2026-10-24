'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { requestOtpEndpoint } from '@/shared/contracts/auth';

import { paperButtonClass, paperInputClass, paperPillLinkClass } from './paper-classes';
import { useRequestOtp } from '../hooks/use-sign-in';
import { routeSubmitError, type AuthDialogState } from '../lib/submit-error';

const schema = requestOtpEndpoint.body;
type Input_ = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export interface EmailFormProps {
  /** Sign-in and sign-up are one flow; the mode only changes the wording and the link below. */
  mode: 'login' | 'register';
  /** False when sign-up is off: the login screen then links to no sign-up page. */
  offerSignUp: boolean;
  defaultEmail: string;
  onCodeSent: (email: string, resendAfterSeconds: number) => void;
  onDialog: (dialog: AuthDialogState) => void;
}

export function EmailForm({
  mode,
  offerSignUp,
  defaultEmail,
  onCodeSent,
  onDialog,
}: EmailFormProps) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('common.errors');
  const request = useRequestOtp();
  const [formError, setFormError] = useState<string | null>(null);
  // A double click sends two submits before the pending state re-renders the button.
  const busyRef = useRef(false);
  const form = useForm<Input_, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const sent = await request.mutateAsync(values);
      onCodeSent(values.email, sent.resendAfterSeconds);
    } catch (error) {
      const code = routeSubmitError(error, {
        setError: form.setError,
        fields: ['email'],
        onDialog,
      });
      if (code) setFormError(tErrors(code));
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Ignore a second submit while one is running: a double click arrives before the button re-renders as busy.
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
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <FormField
        control={form.control}
        name="email"
        label={t('fields.email')}
        description={mode === 'register' ? t('register.emailHint') : undefined}
        required
        className="gap-3"
        render={({ field, controlProps }) => (
          <Input
            {...field}
            {...controlProps}
            type="email"
            dir="ltr"
            autoComplete="email"
            inputMode="email"
            placeholder={t('fields.emailPlaceholder')}
            className={paperInputClass}
          />
        )}
      />
      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" loading={request.isPending} className={paperButtonClass}>
        {t(`${mode}.submit`)}
      </Button>
      {mode === 'register' || offerSignUp ? (
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-on-paper-muted">
          {t(`${mode}.switchPrompt`)}{' '}
          <Link
            href={mode === 'login' ? '/register' : '/login'}
            replace
            className={paperPillLinkClass}
          >
            {t(`${mode}.switchLink`)}
          </Link>
        </p>
      ) : null}
    </form>
  );
}
