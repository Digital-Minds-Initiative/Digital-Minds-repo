'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import type { SignInStep } from '@/shared/contracts/auth';

import { AuthCard } from './auth-card';
import { AuthErrorDialog } from './auth-error-dialog';
import { CodeForm } from './code-form';
import { EmailForm } from './email-form';
import { NameForm } from './name-form';
import { useSessionState } from '../hooks/use-session';
import { useRefreshSession } from '../hooks/use-sign-in';
import type { AuthDialogState } from '../lib/submit-error';

type Step =
  | { name: 'email' }
  | { name: 'code'; resendAfterSeconds: number }
  | { name: 'name'; fullName: string };

/**
 * Sign-in and sign-up are one flow (ADR 0014): email → emailed code → (first time only) name. The
 * server decides after the code whether the person is signed in, must confirm the name an admin
 * stored, or must enter one — so `mode` only changes the wording of the first screen.
 * A reload during the name step resumes there, because the session knows where it is.
 *
 * `selfSignup` is AUTH_SELF_SIGNUP, read by the page on the server. When it is off, sign-in is
 * invite-only (ADR 0027): nothing offers to create an account, and after asking for a code the
 * screen says the same for every address, since the server sends one only to people with access.
 */
export function SignInFlow({
  mode,
  selfSignup,
}: {
  mode: 'login' | 'register';
  selfSignup: boolean;
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const refreshSession = useRefreshSession();
  const session = useSessionState();
  const [step, setStep] = useState<Step | null>(null);
  const [email, setEmail] = useState('');
  const [dialog, setDialog] = useState<AuthDialogState | null>(null);

  const signedIn = session.data?.step === 'signed_in';
  useEffect(() => {
    if (signedIn) router.replace('/dashboard');
  }, [signedIn, router]);

  const resumed: Step | null =
    session.data?.step === 'confirm_name'
      ? { name: 'name', fullName: session.data.fullName }
      : session.data?.step === 'enter_name'
        ? { name: 'name', fullName: '' }
        : null;
  const current: Step = step ?? resumed ?? { name: 'email' };

  if (session.isPending || signedIn) {
    return (
      <AuthCard title={t(`${mode}.title`)}>
        <div aria-busy className="grid gap-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AuthCard>
    );
  }

  function handleVerified(result: SignInStep) {
    refreshSession();
    if (result.step === 'signed_in') {
      router.replace('/dashboard');
      return;
    }
    setStep({ name: 'name', fullName: result.step === 'confirm_name' ? result.fullName : '' });
  }

  function restart() {
    setStep({ name: 'email' });
    refreshSession();
  }

  function handleDialogAction() {
    const kind = dialog?.kind;
    setDialog(null);
    // A dead code can only be replaced by asking for a new one.
    if (kind === 'code_expired' || kind === 'too_many_attempts') restart();
  }

  return (
    <>
      {current.name === 'email' ? (
        <AuthCard title={t(`${mode}.title`)}>
          <EmailForm
            mode={mode}
            offerSignUp={selfSignup}
            defaultEmail={email}
            onDialog={setDialog}
            onCodeSent={(sentTo, resendAfterSeconds) => {
              setEmail(sentTo);
              setStep({ name: 'code', resendAfterSeconds });
            }}
          />
        </AuthCard>
      ) : null}
      {current.name === 'code' ? (
        <AuthCard title={t('code.title')}>
          <CodeForm
            email={email}
            inviteOnly={!selfSignup}
            resendAfterSeconds={current.resendAfterSeconds}
            onVerified={handleVerified}
            onChangeEmail={restart}
            onDialog={setDialog}
          />
        </AuthCard>
      ) : null}
      {current.name === 'name' ? (
        <AuthCard
          title={t('name.title')}
          description={current.fullName ? t('name.confirmLead') : t('name.enterLead')}
        >
          <NameForm
            defaultFullName={current.fullName}
            onCompleted={() => {
              refreshSession();
              router.replace('/dashboard');
            }}
            onSessionLost={restart}
            onDialog={setDialog}
          />
        </AuthCard>
      ) : null}
      <AuthErrorDialog
        kind={dialog?.kind ?? null}
        retryAfterSeconds={dialog?.retryAfterSeconds}
        onOpenChange={(open) => {
          if (!open) handleDialogAction();
        }}
        onAction={handleDialogAction}
      />
    </>
  );
}
