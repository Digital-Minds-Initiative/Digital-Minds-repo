/**
 * University email domain rules. The allowed domains come from the ALLOWED_EMAIL_DOMAINS
 * environment variable (see src/server/env.ts); this file only holds the pure logic so it can be
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
