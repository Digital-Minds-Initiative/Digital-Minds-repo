import { describe, expect, it } from 'vitest';

import { clientIp } from '../request-guards';

const headers = (values: Record<string, string>) => new Headers(values);

describe('clientIp', () => {
  it('trusts no header unless one is configured', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.7' }), null)).toBeNull();
  });

  it('reads the configured header', () => {
    expect(clientIp(headers({ 'x-real-ip': '203.0.113.7' }), 'x-real-ip')).toBe('203.0.113.7');
    expect(clientIp(headers({ 'x-real-ip': '2001:db8::1' }), 'x-real-ip')).toBe('2001:db8::1');
  });

  it('uses the last list entry: the one our proxy appended, not the forgeable ones before it', () => {
    expect(
      clientIp(headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }), 'x-forwarded-for'),
    ).toBe('203.0.113.7');
  });

  it('ignores a missing header or a value that is not an IP', () => {
    expect(clientIp(headers({}), 'x-forwarded-for')).toBeNull();
    expect(clientIp(headers({ 'x-forwarded-for': 'unknown' }), 'x-forwarded-for')).toBeNull();
    expect(clientIp(headers({ 'x-forwarded-for': ' , ' }), 'x-forwarded-for')).toBeNull();
  });
});
