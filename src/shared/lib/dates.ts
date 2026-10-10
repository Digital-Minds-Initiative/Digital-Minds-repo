/**
 * Calendar-date helpers. Business dates (a point transaction's work date, period filters) are
 * calendar dates in Saudi Arabia, not instants. They travel as `YYYY-MM-DD` strings and are
 * stored in `@db.Date` columns.
 */

export const APP_TIME_ZONE = 'Asia/Riyadh';

const calendarFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Saudi Arabia as `YYYY-MM-DD`. */
export function todayInAppTimeZone(now: Date = new Date()): string {
  const parts = calendarFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** True when a `YYYY-MM-DD` date is after today in Saudi Arabia. */
export function isFutureDate(isoDate: string, now: Date = new Date()): boolean {
  // ISO dates compare correctly as strings.
  return isoDate > todayInAppTimeZone(now);
}

/** `YYYY-MM-DD` → the Date Prisma expects for a `@db.Date` column (UTC midnight). */
export function dateOnlyToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** A `@db.Date` value → `YYYY-MM-DD`. */
export function dateToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds (or subtracts) whole days to a `YYYY-MM-DD` date. */
export function addDays(isoDate: string, days: number): string {
  const date = dateOnlyToDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToDateOnly(date);
}
