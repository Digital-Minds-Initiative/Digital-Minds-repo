/**
 * University email domain rules. The allowed domains come from the ALLOWED_EMAIL_DOMAINS
 * environment variable (see src/server/env.ts); this file only holds the pure logic so it can be
 * unit-tested and reused.
 */

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
