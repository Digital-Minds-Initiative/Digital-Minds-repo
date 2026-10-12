import 'server-only';

import type { EmailMessage, EmailSender } from './types';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

interface ResendOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}

/**
 * Production sender, through Resend's REST API (https://resend.com/docs/api-reference/emails).
 * Errors name the HTTP status only — never the recipient.
 */
export function createResendSender({ apiKey, from, fetch = globalThis.fetch }: ResendOptions) {
  const sender: EmailSender = {
    async send(message: EmailMessage) {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Resend refused the email (HTTP ${response.status}).`);
      }
    },
  };
  return sender;
}
