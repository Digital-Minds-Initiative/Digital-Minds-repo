import { describe, expect, it } from 'vitest';

import { otpCodeSchema, verifyOtpEndpoint } from '../auth';

describe('otpCodeSchema', () => {
  it.each([
    ['12345678', '12345678'],
    ['01234567', '01234567'],
    ['١٢٣٤٥٦٧٨', '12345678'], // Arabic-Indic digits (Arabic keyboard)
    ['۱۲۳۴۵۶۷۸', '12345678'], // Persian digits
    ['١٢٣٤ ٥٦٧٨', '12345678'], // spaces between groups
    ['  12 34 56 78 ', '12345678'],
    ['12٣4۵6٧8', '12345678'], // mixed
    ['1234 5678', '12345678'], // no-break space from a paste
  ])('accepts %j as %s', (input, expected) => {
    expect(otpCodeSchema.parse(input)).toBe(expected);
  });

  it.each(['1234567', '123456789', '12a45678', '12-45678', '', '１２３４５６７８'])(
    'rejects %j',
    (input) => {
      const result = otpCodeSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('invalid_code_format');
    },
  );

  it('normalises the email and the code in the verify body', () => {
    expect(
      verifyOtpEndpoint.body.parse({ email: ' S443001234@ST.UQU.EDU.SA ', code: '٠١٢٣ ٤٥٦٧' }),
    ).toEqual({ email: 's443001234@st.uqu.edu.sa', code: '01234567' });
  });
});
