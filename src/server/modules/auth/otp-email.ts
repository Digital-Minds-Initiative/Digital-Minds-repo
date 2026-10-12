import 'server-only';

import { createTranslator } from 'next-intl';

import emailMessages from '@/i18n/messages/ar/email.json';
import type { EmailMessage } from '@/server/email';

/*
 * The sign-in code email: Arabic, right-to-left HTML plus a plain-text version. Strings live in
 * src/i18n/messages/ar/email.json. Email clients ignore stylesheets and CSS variables, so the
 * HTML uses inline styles with literal colours (the design-token rule is for the app UI).
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

  const paragraph = (value: string, style = '') =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#1f2933;${style}">${escapeHtml(value)}</p>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:18px;font-weight:bold;color:#1f2933">${escapeHtml(t('platform'))}</p>
${paragraph(t('reason'))}
<p style="margin:24px 0 4px;font-size:13px;color:#52606d">${escapeHtml(t('codeLabel'))}</p>
<p dir="ltr" style="margin:0 0 24px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;color:#1f2933;text-align:right">${escapeHtml(code)}</p>
${paragraph(validity)}
${paragraph(t('doNotShare'))}
${paragraph(t('ignore'), 'color:#52606d')}
<p style="margin:24px 0 0;font-size:12px;color:#7b8794">${escapeHtml(t('footer'))}</p>
</div>
</body>
</html>`;

  return { to, subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
