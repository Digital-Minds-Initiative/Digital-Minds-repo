import 'server-only';

import { env } from '@/server/env';

import { devEmailSender } from './dev';
import { createResendSender } from './resend';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';

/**
 * EMAIL_TRANSPORT decides: `resend` sends for real, `console` prints the message (sign-in
 * code included) and keeps it in memory for tests. It defaults to the console in development
 * and test and to Resend in production, and env.ts refuses to start a server whose transport
 * has no key — so this is a choice, never a guess from which variables happen to be set.
 */
export const emailSender: EmailSender =
  env.EMAIL_TRANSPORT === 'resend' ? resend() : devEmailSender;

function resend(): EmailSender {
  const { RESEND_API_KEY: apiKey, EMAIL_FROM: from } = env;
  // env.ts already refused to start without both; this is what tells TypeScript so.
  if (!apiKey || !from) {
    throw new Error('EMAIL_TRANSPORT is "resend" but RESEND_API_KEY or EMAIL_FROM is missing.');
  }
  return createResendSender({ apiKey, from });
}
