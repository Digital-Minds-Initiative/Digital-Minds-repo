import 'server-only';

import { env } from '@/server/env';

import { devEmailSender } from './dev';
import { createResendSender } from './resend';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';

/**
 * Resend when RESEND_API_KEY is set (always on a production server — env.ts requires it),
 * otherwise the dev sender, which keeps emails in memory and prints them to the console.
 */
export const emailSender: EmailSender =
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? createResendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : devEmailSender;
