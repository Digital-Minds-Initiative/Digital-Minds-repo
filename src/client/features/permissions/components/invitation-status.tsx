'use client';

import { Mail } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import type { InvitationOutcome } from '@/shared/contracts/permissions';

import { useResendInvitation } from '../hooks/use-permissions';

/*
 * Invitations on the permissions page (docs/adr/0027-invite-only-sign-in.md): what a grant's
 * invitation came to, the «لم يسجّل بعد · دُعي قبل …» line under a holder who has not signed in,
 * and resending it.
 */

interface InvitationTarget {
  memberId: string;
  /** The committee of a lead invitation; absent for a club-officer one. */
  committeeId?: string;
}

/** Toasts for a grant's invitation, and the resend they offer when it failed. */
export function useInvitationFeedback() {
  const t = useTranslations('permissions.invitations');
  const format = useFormatter();
  const errorText = useErrorText();
  const resendInvitation = useResendInvitation();

  const inAbout = (seconds: number) =>
    format.relativeTime(new Date(Date.now() + seconds * 1000), new Date());

  async function resend(target: InvitationTarget): Promise<void> {
    try {
      await resendInvitation.mutateAsync(target);
      toast.success(t('resent'));
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === 'too_many_invitations') {
        toast.error(t('limitedTitle'), {
          description: t('limitedBody', { when: inAbout(error.details.retryAfterSeconds ?? 0) }),
        });
        return;
      }
      toast.error(t('failedTitle'), {
        description: errorText(error),
        action: { label: t('resend'), onClick: () => void resend(target) },
        duration: 10_000,
      });
    }
  }

  /** The toast after a grant: `title` says what was granted, the rest what the email did. */
  function afterGrant(
    title: string,
    invitation: InvitationOutcome | null,
    target: InvitationTarget,
  ): void {
    if (invitation === null) {
      toast.success(title);
    } else if (invitation.status === 'sent') {
      toast.success(title, { description: t('sent') });
    } else if (invitation.status === 'limited') {
      toast.success(title, {
        description: t('limited', { when: inAbout(invitation.retryAfterSeconds) }),
      });
    } else {
      toast.error(t('failedTitle'), {
        description: t('failedBody'),
        action: { label: t('resend'), onClick: () => void resend(target) },
        duration: 10_000,
      });
    }
  }

  return { afterGrant, resend, resending: resendInvitation.isPending };
}

/**
 * Under a role holder who has never signed in: that they have not, when this club last invited
 * them, and — for whoever may grant the role — a button to send it again.
 */
export function InvitationStatus({
  name,
  invitedAt,
  target,
  canResend,
}: {
  name: string;
  invitedAt: string | null;
  target: InvitationTarget;
  canResend: boolean;
}) {
  const t = useTranslations('permissions.invitations');
  const format = useFormatter();
  // Re-renders every minute, so «قبل دقيقة» does not stay on screen for an hour.
  const now = useNow({ updateInterval: 60_000 });
  const { resend, resending } = useInvitationFeedback();

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <span>
        {t('notRegistered')} ·{' '}
        {invitedAt
          ? t('invitedAgo', { ago: format.relativeTime(new Date(invitedAt), now) })
          : t('neverInvited')}
      </span>
      {canResend ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          loading={resending}
          aria-label={t('resendLabel', { name })}
          onClick={() => void resend(target)}
        >
          <Mail aria-hidden />
          {t('resend')}
        </Button>
      ) : null}
    </span>
  );
}
