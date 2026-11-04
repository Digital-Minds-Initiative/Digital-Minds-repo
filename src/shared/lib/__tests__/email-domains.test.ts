import { describe, expect, it } from 'vitest';

import { checkEmailAddress, isAllowedEmailDomain, parseEmailDomains } from '../email-domains';

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

describe('checkEmailAddress', () => {
  const policy = { institutional: ['uqu.edu.sa'], personal: ['gmail.com', 'outlook.com'] };

  it('accepts the institutional domains as before, +tags included', () => {
    expect(checkEmailAddress('s000000001@st.uqu.edu.sa', policy)).toBeNull();
    expect(checkEmailAddress('staff+club@uqu.edu.sa', policy)).toBeNull();
  });

  it('accepts a listed provider, dots kept as typed', () => {
    expect(checkEmailAddress('someone@gmail.com', policy)).toBeNull();
    expect(checkEmailAddress('some.one@gmail.com', policy)).toBeNull();
    expect(checkEmailAddress('someone@outlook.com', policy)).toBeNull();
  });

  it('refuses a +tag on a provider', () => {
    expect(checkEmailAddress('someone+club@gmail.com', policy)).toBe('email_alias_not_allowed');
    expect(checkEmailAddress('someone+@outlook.com', policy)).toBe('email_alias_not_allowed');
  });

  it('matches a provider exactly: no subdomains, no look-alikes, no unlisted providers', () => {
    expect(checkEmailAddress('someone@mail.gmail.com', policy)).toBe('email_domain_not_allowed');
    expect(checkEmailAddress('someone@evil-gmail.com', policy)).toBe('email_domain_not_allowed');
    expect(checkEmailAddress('someone@gmail.com.evil.com', policy)).toBe(
      'email_domain_not_allowed',
    );
    expect(checkEmailAddress('someone@hotmail.com', policy)).toBe('email_domain_not_allowed');
    expect(checkEmailAddress('someone+x@yahoo.com', policy)).toBe('email_domain_not_allowed');
    expect(checkEmailAddress('not-an-email', policy)).toBe('email_domain_not_allowed');
    expect(checkEmailAddress('@gmail.com', policy)).toBe('email_domain_not_allowed');
  });

  it('allows only the institutional domains when no provider is listed', () => {
    const universityOnly = { institutional: ['uqu.edu.sa'], personal: [] };
    expect(checkEmailAddress('someone@gmail.com', universityOnly)).toBe('email_domain_not_allowed');
  });
});
