import 'server-only';

import { logger } from '@/server/logger';
import { normalizeEmail } from '@/shared/lib/email-domains';

import type { EmailSender } from './types';

/**
 * EMAIL_ALLOWLIST, for the hosted dev environment: it sends real email through Resend, but its
 * data is the demo seed and its testers are a handful of people. With a list, only those
 * addresses receive anything; every other send is logged (without the address) and skipped.
 *
 * Skipping is invisible to the caller — `send` resolves as if the email went out — so sign-in,
 * invitations and their limits behave exactly as they would with the list unset. Null (unset)
 * returns the sender unchanged. A production deployment refuses to start with a list
 * (src/server/env.ts).
 */
export function withEmailAllowlist(
  sender: EmailSender,
  allowlist: readonly string[] | null,
): EmailSender {
  if (!allowlist) return sender;
  const allowed = new Set(allowlist.map(normalizeEmail));
  return {
    async send(message) {
      if (allowed.has(normalizeEmail(message.to))) {
        await sender.send(message);
        return;
      }
      logger.warn('Email skipped: the recipient is not on EMAIL_ALLOWLIST.');
    },
  };
}
