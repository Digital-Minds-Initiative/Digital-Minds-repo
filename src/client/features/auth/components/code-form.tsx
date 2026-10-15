'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { verifyOtpEndpoint, type SignInStep } from '@/shared/contracts/auth';

import { OtpInput } from './otp-input';
import { paperButtonClass, paperLinkClass } from './paper-classes';
import { useRequestOtp, useVerifyOtp } from '../hooks/use-sign-in';
import { routeSubmitError, type AuthDialogState } from '../lib/submit-error';

const schema = verifyOtpEndpoint.body.pick({ code: true });
type Input_ = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export interface CodeFormProps {
  email: string;
  /** Seconds until another code may be requested (from the request that just succeeded). */
  resendAfterSeconds: number;
  onVerified: (step: SignInStep) => void;
  onChangeEmail: () => void;
  onDialog: (dialog: AuthDialogState) => void;
}

export function CodeForm({
  email,
  resendAfterSeconds,
  onVerified,
  onChangeEmail,
  onDialog,
}: CodeFormProps) {
  const t = useTranslations('auth.code');
  const tErrors = useTranslations('common.errors');
  const verify = useVerifyOtp();
  const request = useRequestOtp();
  const [formError, setFormError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + resendAfterSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const form = useForm<Input_, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const submit = form.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      onVerified(await verify.mutateAsync({ email, code }));
    } catch (error) {
      form.resetField('code');
      const message = routeSubmitError(error, {
        setError: form.setError,
        fields: ['code'],
        onDialog,
      });
      if (message) setFormError(tErrors(message));
    }
  });

  async function resend() {
    setFormError(null);
    try {
      const sent = await request.mutateAsync({ email });
      form.resetField('code');
      setNow(Date.now());
      setResendAt(Date.now() + sent.resendAfterSeconds * 1000);
    } catch (error) {
      const message = routeSubmitError(error, {
        setError: form.setError,
        fields: [],
        onDialog,
      });
      if (message) setFormError(tErrors(message));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <p className="text-center text-sm leading-6 text-on-paper-muted">
        {t('sentTo')} <bdi dir="ltr">{email}</bdi>
      </p>
      <FormField
        control={form.control}
        name="code"
        label={t('label')}
        required
        className="gap-3"
        render={({ field, controlProps }) => (
          <OtpInput
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            disabled={field.disabled}
            {...controlProps}
          />
        )}
      />
      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" loading={verify.isPending} className={paperButtonClass}>
        {t('submit')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={onChangeEmail}
          className={`${paperLinkClass} cursor-pointer`}
        >
          {t('changeEmail')}
        </button>
        {secondsLeft > 0 ? (
          <span className="text-on-paper-muted">{t('resendIn', { seconds: secondsLeft })}</span>
        ) : (
          <button
            type="button"
            onClick={() => void resend()}
            disabled={request.isPending}
            className={`${paperLinkClass} cursor-pointer disabled:opacity-50`}
          >
            {t('resend')}
          </button>
        )}
      </div>
    </form>
  );
}
