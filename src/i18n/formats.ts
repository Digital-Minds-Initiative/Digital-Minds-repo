import type { Formats } from 'next-intl';

/**
 * Named formats: `format.dateTime(date, 'date')`, `format.number(points, 'points')`.
 * The `ar` locale uses Latin digits (0-9) and the Gregorian calendar, which matches the data
 * (phone numbers, student ids). `ar-SA` would switch to Arabic-Indic digits and the Hijri calendar.
 */
export const formats = {
  dateTime: {
    date: { day: 'numeric', month: 'long', year: 'numeric' },
    dateShort: { day: 'numeric', month: 'short', year: 'numeric' },
    dateTime: {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    points: { maximumFractionDigits: 0, signDisplay: 'exceptZero' },
  },
} satisfies Formats;
