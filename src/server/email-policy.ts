import 'server-only';

import { isAllowedEmailDomain } from '@/shared/lib/email-domains';

import { env } from './env';
import { ValidationError } from './errors';

/**
 * Accounts are university-only. The allowed domains come from ALLOWED_EMAIL_DOMAINS, so this check
 * runs on the server rather than in the shared Zod contract.
 */
export function assertUniversityEmail(
  email: string,
  path: Array<string | number> = ['body', 'uniEmail'],
): void {
  if (!isAllowedEmailDomain(email, env.ALLOWED_EMAIL_DOMAINS)) {
    throw new ValidationError([
      {
        path,
        code: 'email_domain_not_allowed',
        message: `Use a university email (${env.ALLOWED_EMAIL_DOMAINS.join(', ')}).`,
      },
    ]);
  }
}
