import 'server-only';

import { createTranslator } from 'next-intl';

import emailMessages from '@/i18n/messages/ar/email.json';
import type { EmailMessage } from '@/server/email';
import { emailButton, emailDocument, emailParagraph } from '@/server/email/layout';

/*
 * The invitation a person gets when they are given a role before they have ever signed in
 * (docs/adr/0027-invite-only-sign-in.md). Same sender and look as the sign-in code email.
 *
 * It carries no secret: the link is the ordinary login page, with nothing in the URL — not a
 * token, not the address. The code emailed at sign-in is what proves who they are, so a
 * forwarded or leaked invitation lets nobody in.
 */

const t = createTranslator({
  locale: 'ar',
  messages: { email: emailMessages },
  namespace: 'email.roleInvitation',
});

export type InvitedRole =
  | { kind: 'club_officer'; club: string }
  | { kind: 'committee_lead'; club: string; committee: string };

export function buildInvitationEmail(
  to: string,
  role: InvitedRole,
  appOrigin: string,
): EmailMessage {
  const subject = t('subject');
  const loginUrl = `${appOrigin}/login`;
  const granted =
    role.kind === 'club_officer'
      ? t('clubOfficer', { club: role.club })
      : t('committeeLead', { club: role.club, committee: role.committee });

  const text = [
    t('platform'),
    '',
    granted,
    '',
    `${t('linkLabel')}: ${loginUrl}`,
    t('howToSignIn'),
    t('junk'),
    '',
    t('ignore'),
    '',
    t('footer'),
  ].join('\n');

  const html = emailDocument({
    subject,
    platform: t('platform'),
    footer: t('footer'),
    content: [
      emailParagraph(granted),
      emailButton(t('button'), loginUrl),
      emailParagraph(t('howToSignIn')),
      emailParagraph(t('junk')),
      emailParagraph(t('ignore'), { muted: true }),
    ].join('\n'),
  });

  return { to, subject, html, text };
}
