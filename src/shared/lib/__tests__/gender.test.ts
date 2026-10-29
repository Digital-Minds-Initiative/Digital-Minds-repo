import { describe, expect, it } from 'vitest';

import { parseGender } from '../gender';

describe('parseGender', () => {
  it.each([
    ['ذكر', 'MALE'],
    [' ذكر ', 'MALE'],
    ['male', 'MALE'],
    ['MALE', 'MALE'],
    ['Male', 'MALE'],
    ['أنثى', 'FEMALE'],
    ['انثى', 'FEMALE'],
    ['إنثى', 'FEMALE'],
    ['female', 'FEMALE'],
    ['  FeMale\t', 'FEMALE'],
  ] as const)('reads %j as %s', (input, expected) => {
    expect(parseGender(input)).toBe(expected);
  });

  it.each(['', ' ', 'm', 'f', 'ذكور', 'إناث', 'آنثى', 'أنثي', 'man', 'woman', 'MALE.'])(
    'refuses %j',
    (input) => {
      expect(parseGender(input)).toBeNull();
    },
  );
});
