import { describe, expect, it } from 'vitest';

import { otpCodeSchema, verifyOtpEndpoint } from '../auth';

describe('otpCodeSchema', () => {
  it.each([
    ['123456', '123456'],
    ['012345', '012345'],
    ['١٢٣٤٥٦', '123456'], // Arabic-Indic digits (Arabic keyboard)
    ['۱۲۳۴۵۶', '123456'], // Persian digits
    ['١٢٣ ٤٥٦', '123456'], // spaces between groups
    ['  12 34 56 ', '123456'],
    ['12٣4۵6', '123456'], // mixed
    ['123 456', '123456'], // no-break space from a paste
  ])('accepts %j as %s', (input, expected) => {
    expect(otpCodeSchema.parse(input)).toBe(expected);
  });

  it.each(['12345', '1234567', '12a456', '12-456', '', '１２３４５６'])('rejects %j', (input) => {
    const result = otpCodeSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('invalid_code_format');
  });

  it('normalises the email and the code in the verify body', () => {
    expect(
      verifyOtpEndpoint.body.parse({ email: ' S443001234@ST.UQU.EDU.SA ', code: '٠١٢ ٣٤٥' }),
    ).toEqual({ email: 's443001234@st.uqu.edu.sa', code: '012345' });
  });
});
