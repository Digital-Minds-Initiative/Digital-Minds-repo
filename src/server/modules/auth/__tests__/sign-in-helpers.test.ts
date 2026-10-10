import { describe, expect, it } from 'vitest';

import emailMessages from '@/i18n/messages/ar/email.json';

import {
  digestsMatch,
  emailKey,
  generateOtpCode,
  generateSessionToken,
  otpCodeHash,
  sessionTokenHash,
} from '../crypto';
import { buildOtpEmail } from '../otp-email';

describe('sign-in crypto', () => {
  it('generates 6-digit codes, leading zeros included', () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);
    expect(codes.every((code) => /^[0-9]{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1900);
  });

  it('keys code hashes by email and secret, never storing the code itself', () => {
    const hash = otpCodeHash('a@uqu.edu.sa', '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
    expect(otpCodeHash('b@uqu.edu.sa', '123456')).not.toBe(hash);
    expect(otpCodeHash('a@uqu.edu.sa', '123457')).not.toBe(hash);
    expect(emailKey('a@uqu.edu.sa')).not.toContain('uqu');
  });

  it('compares digests in constant time and rejects different lengths', () => {
    const hash = otpCodeHash('a@uqu.edu.sa', '123456');
    expect(digestsMatch(hash, otpCodeHash('a@uqu.edu.sa', '123456'))).toBe(true);
    expect(digestsMatch(hash, otpCodeHash('a@uqu.edu.sa', '654321'))).toBe(false);
    expect(digestsMatch(hash, hash.slice(0, 32))).toBe(false);
  });

  it('makes 256-bit session tokens and stores only their SHA-256', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(token);
    expect(sessionTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sign-in code email', () => {
  const email = buildOtpEmail('s443001234@st.uqu.edu.sa', '042917', 10);
  const strings = emailMessages.signInCode;

  it('is addressed, with an Arabic subject', () => {
    expect(email.to).toBe('s443001234@st.uqu.edu.sa');
    expect(email.subject).toBe(strings.subject);
  });

  it('has a right-to-left Arabic HTML version showing the code left-to-right', () => {
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toMatch(/<p dir="ltr"[^>]*>042917<\/p>/);
  });

  it('explains why it was sent, how long the code lasts, and what to do if unexpected', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('042917');
      expect(body).toContain(strings.platform);
      expect(body).toContain(strings.reason);
      expect(body).toContain('الرمز صالح لمدة 10 دقائق');
      expect(body).toContain(strings.ignore);
      expect(body).toContain(strings.doNotShare);
    }
  });

  it('takes every visible string from the translations', () => {
    const visible = email.html
      .replace(/<head>[\s\S]*<\/head>/, '')
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const known = new Set([
      ...Object.values(strings),
      'الرمز صالح لمدة 10 دقائق، ويُستخدم مرة واحدة فقط.',
      '042917',
    ]);
    expect(visible.filter((line) => !known.has(line))).toEqual([]);
    expect(email.text.split('\n').filter((line) => line && !known.has(line))).toEqual([
      `${strings.codeLabel}: 042917`,
    ]);
  });
});
