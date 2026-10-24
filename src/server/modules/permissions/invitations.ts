import 'server-only';

import { membersScope, type Actor } from '@/server/authz';
import { emailSender } from '@/server/email';
import { env } from '@/server/env';
import { logger } from '@/server/logger';
import { consumeFixedWindow, refundFixedWindow } from '@/server/modules/rate-limit';
import {
  INVITATIONS_PER_PERSON_PER_DAY,
  type InvitationOutcome,
} from '@/shared/contracts/permissions';

import { buildInvitationEmail, type InvitedRole } from './invitation-email';
import { insertRoleInvitation } from './repository';

/*
 * Sending a role invitation (docs/adr/0027-invite-only-sign-in.md): automatically when a role is
 * granted to someone who has not signed in yet, and again on request. The caller has already
 * decided the person should get one; this counts it, sends it and records it.
 */

/**
 * Per person, in fixed UTC days. Its own name, so no other surface spends this budget. Only
 * emails that went out count: a send the provider refuses is given back.
 */
const INVITATION_LIMIT = {
  name: 'roleInvitationPerPerson',
  max: INVITATIONS_PER_PERSON_PER_DAY,
  windowSeconds: 24 * 60 * 60,
} as const;

export interface InvitationTarget {
  memberId: string;
  committeeId: string | null;
  userId: string;
  uniEmail: string;
  role: InvitedRole;
}

/**
 * Counts, sends and records one invitation. Answers `limited` past the daily maximum and sends
 * nothing; throws whatever the email sender throws, after giving the use back.
 */
export async function sendInvitation(
  actor: Actor,
  target: InvitationTarget,
): Promise<{ status: 'sent'; sentAt: Date } | { status: 'limited'; retryAfterSeconds: number }> {
  const now = new Date();
  const { exceeded, retryAfterSeconds } = await consumeFixedWindow(
    INVITATION_LIMIT,
    target.userId,
    now,
  );
  if (exceeded) {
    // Refused uses are given back too, so the counter is always the sends plus those in flight
    // — one that fails afterwards then frees a slot that is really free.
    await refundFixedWindow(INVITATION_LIMIT, target.userId, now);
    return { status: 'limited', retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) };
  }

  try {
    await emailSender.send(buildInvitationEmail(target.uniEmail, target.role, env.APP_ORIGIN));
  } catch (error) {
    // The send's error is the one to report; a refund that fails too must not replace it.
    await refundFixedWindow(INVITATION_LIMIT, target.userId, now).catch((refundError: unknown) =>
      logger.error('An invitation that was not sent could not be uncounted.', {
        memberId: target.memberId,
        error: refundError,
      }),
    );
    throw error;
  }
  await insertRoleInvitation(membersScope(actor), {
    memberId: target.memberId,
    committeeId: target.committeeId,
    sentById: actor.userId,
    sentAt: now,
  });
  return { status: 'sent', sentAt: now };
}

/**
 * The invitation that goes with a grant. The role is granted whatever happens here, so nothing is
 * thrown: a failure is logged (ids only, never the address) and reported as `failed`.
 */
export async function inviteAfterGrant(
  actor: Actor,
  target: InvitationTarget,
): Promise<InvitationOutcome> {
  try {
    const result = await sendInvitation(actor, target);
    return result.status === 'sent'
      ? { status: 'sent', sentAt: result.sentAt.toISOString() }
      : result;
  } catch (error) {
    logger.error('The role invitation email could not be sent.', {
      memberId: target.memberId,
      committeeId: target.committeeId,
      error,
    });
    return { status: 'failed' };
  }
}
