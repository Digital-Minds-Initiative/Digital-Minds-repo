import 'server-only';

import type { EmailMessage, EmailSender } from './types';

/**
 * Development and test sender: nothing leaves the machine. Each email is kept in memory (tests
 * read the sign-in code from it) and, outside tests, printed to the server console so you can
 * sign in locally. The address is masked; the text body is printed in full.
 */

const sent: EmailMessage[] = [];

export const devEmailSender: EmailSender = {
  send(message) {
    sent.push(message);
    if (process.env.NODE_ENV !== 'test') {
      console.info(
        `\n[dev email] to ${maskEmail(message.to)} — ${message.subject}\n${message.text}\n`,
      );
    }
    return Promise.resolve();
  },
};

/** Emails sent since the last `clearSentEmails()`, oldest first. */
export function sentEmails(): readonly EmailMessage[] {
  return sent;
}

export function clearSentEmails(): void {
  sent.length = 0;
}

/** `s443001234@st.uqu.edu.sa` → `s44***@st.uqu.edu.sa` */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, Math.min(3, at))}***${email.slice(at)}`;
}
