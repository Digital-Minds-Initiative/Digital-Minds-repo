import 'server-only';

import { checkEmailAddress, type EmailDomainPolicy } from '@/shared/lib/email-domains';

import { env } from './env';
import { ValidationError } from './errors';

/**
 * Which addresses may hold an account: the university's domains (ALLOWED_EMAIL_DOMAINS) and the
 * public mail providers in ALLOWED_PERSONAL_EMAIL_DOMAINS (docs/adr/0030-personal-email-domains.md).
 * Both come from the environment, so this check runs on the server rather than in the shared Zod
 * contract.
 */
export const emailDomainPolicy: EmailDomainPolicy = {
  institutional: env.ALLOWED_EMAIL_DOMAINS,
  personal: env.ALLOWED_PERSONAL_EMAIL_DOMAINS,
};

const MESSAGES = {
  email_domain_not_allowed: `Use an email address from an allowed domain (${[
    ...emailDomainPolicy.institutional,
    ...emailDomainPolicy.personal,
  ].join(', ')}).`,
  email_alias_not_allowed: 'Use the address without a "+" alias.',
} as const;

export function assertAllowedEmail(
  email: string,
  path: Array<string | number> = ['body', 'uniEmail'],
): void {
  const problem = checkEmailAddress(email, emailDomainPolicy);
  if (problem) {
    throw new ValidationError([{ path, code: problem, message: MESSAGES[problem] }]);
  }
}
