import { describe, expect, it } from 'vitest';

import { isAllowedEmailDomain, parseEmailDomains } from '../email-domains';

describe('parseEmailDomains', () => {
  it('splits, trims, lower-cases and drops a leading @', () => {
    expect(parseEmailDomains(' uqu.edu.sa, @Other.EDU ,, ')).toEqual(['uqu.edu.sa', 'other.edu']);
  });
});

describe('isAllowedEmailDomain', () => {
  const allowed = ['uqu.edu.sa'];

  it('accepts the domain and its subdomains', () => {
    expect(isAllowedEmailDomain('staff@uqu.edu.sa', allowed)).toBe(true);
    expect(isAllowedEmailDomain('s000000001@st.uqu.edu.sa', allowed)).toBe(true);
    expect(isAllowedEmailDomain('S000000001@ST.UQU.EDU.SA', allowed)).toBe(true);
  });

  it('rejects look-alike and unrelated domains', () => {
    expect(isAllowedEmailDomain('someone@gmail.com', allowed)).toBe(false);
    expect(isAllowedEmailDomain('someone@evil-uqu.edu.sa', allowed)).toBe(false);
    expect(isAllowedEmailDomain('someone@uqu.edu.sa.evil.com', allowed)).toBe(false);
    expect(isAllowedEmailDomain('not-an-email', allowed)).toBe(false);
  });
});
