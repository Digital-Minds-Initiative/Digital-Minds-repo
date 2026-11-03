/**
 * Which addresses may hold an account. The domains come from ALLOWED_EMAIL_DOMAINS (institutional)
 * and ALLOWED_PERSONAL_EMAIL_DOMAINS (public mail providers) — see src/server/env.ts and
 * docs/adr/0030-personal-email-domains.md; this file only holds the pure logic so it can be
 * unit-tested and reused.
 */

/**
 * How an address is written, wherever it is stored or compared. Addresses are kept lower-case
 * (a CHECK constraint on `User.uniEmail` enforces it), and they identify a person: sign-in,
 * adding a member and the uniqueness constraint must all agree on the same spelling. Applied by
 * the contract fields and again by the services that store one.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** "uqu.edu.sa, @Other.edu" → ["uqu.edu.sa", "other.edu"] */
export function parseEmailDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter((domain) => domain.length > 0);
}

/** An allowed domain also allows its subdomains: "uqu.edu.sa" accepts "st.uqu.edu.sa". */
export function isAllowedEmailDomain(email: string, allowedDomains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

/** The two kinds of allowed domain, as src/server/env.ts reads them. */
export interface EmailDomainPolicy {
  /** The university's own domains: the domain and its subdomains, any local part. */
  institutional: readonly string[];
  /**
   * Public mail providers (Gmail, Outlook…): the exact domain only, and no `+tag` in the local
   * part. `name+x@gmail.com` reaches the same inbox as `name@gmail.com`, so allowing it would let
   * one person hold several accounts and spread their sign-in limits across them.
   */
  personal: readonly string[];
}

export type EmailAddressProblem = 'email_domain_not_allowed' | 'email_alias_not_allowed';

/** Null when the (normalised) address may hold an account, else why not. */
export function checkEmailAddress(
  email: string,
  policy: EmailDomainPolicy,
): EmailAddressProblem | null {
  if (isAllowedEmailDomain(email, policy.institutional)) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return 'email_domain_not_allowed';
  const domain = email.slice(at + 1).toLowerCase();
  if (!policy.personal.includes(domain)) return 'email_domain_not_allowed';
  if (email.slice(0, at).includes('+')) return 'email_alias_not_allowed';
  return null;
}
