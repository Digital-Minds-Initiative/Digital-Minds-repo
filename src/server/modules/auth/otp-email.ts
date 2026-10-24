import 'server-only';

import { createTranslator } from 'next-intl';

import emailMessages from '@/i18n/messages/ar/email.json';
import type { EmailMessage } from '@/server/email';
import { EMAIL_COLOURS, emailDocument, emailParagraph, escapeHtml } from '@/server/email/layout';

/*
 * The sign-in code email: Arabic, right-to-left HTML plus a plain-text version. Strings live in
 * src/i18n/messages/ar/email.json; the shared look is src/server/email/layout.ts.
 */

const t = createTranslator({
  locale: 'ar',
  messages: { email: emailMessages },
  namespace: 'email.signInCode',
});

export function buildOtpEmail(to: string, code: string, validMinutes: number): EmailMessage {
  const validity = t('validity', { minutes: validMinutes });
  const subject = t('subject');

  const text = [
    t('platform'),
    '',
    t('reason'),
    '',
    `${t('codeLabel')}: ${code}`,
    validity,
    '',
    t('doNotShare'),
    t('ignore'),
    '',
    t('footer'),
  ].join('\n');

  const html = emailDocument({
    subject,
    platform: t('platform'),
    footer: t('footer'),
    content: [
      emailParagraph(t('reason')),
      `<p style="margin:24px 0 4px;font-size:13px;color:${EMAIL_COLOURS.muted}">${escapeHtml(t('codeLabel'))}</p>`,
      `<p dir="ltr" style="margin:0 0 24px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;color:${EMAIL_COLOURS.text};text-align:right">${escapeHtml(code)}</p>`,
      emailParagraph(validity),
      emailParagraph(t('doNotShare')),
      emailParagraph(t('ignore'), { muted: true }),
    ].join('\n'),
  });

  return { to, subject, html, text };
}
