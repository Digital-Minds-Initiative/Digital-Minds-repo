import { describe, expect, it } from 'vitest';

import { normalizePhone } from './phone';

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
