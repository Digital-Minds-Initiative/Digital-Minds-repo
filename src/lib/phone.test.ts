import { describe, expect, it } from 'vitest';

import { normalizePhone, phoneSearchDigits } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['0551234567', '+966551234567'],
    ['551234567', '+966551234567'],
    ['+966 55 123 4567', '+966551234567'],
    ['966551234567', '+966551234567'],
    ['00966551234567', '+966551234567'],
    ['٠٥٥١٢٣٤٥٦٧', '+966551234567'],
    ['055-123-4567', '+966551234567'],
    ['+14155552671', '+14155552671'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '05512345', '+0123456789'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('phoneSearchDigits', () => {
  // Every way people type the same number must find "+966551234567".
  it.each([
    ['0551234567', '551234567'],
    ['055 123', '55123'],
    ['+966 55 123 4567', '551234567'],
    ['00966551234567', '551234567'],
    ['٠٥٥١٢٣٤٥٦٧', '551234567'],
    ['4567', '4567'],
  ])('searches %s as %s', (input, expected) => {
    expect(phoneSearchDigits(input)).toBe(expected);
    expect('+966551234567').toContain(expected);
  });

  it.each(['سارة', '055', 's443'])('ignores %s (fewer than four digits)', (input) => {
    expect(phoneSearchDigits(input)).toBeNull();
  });
});
