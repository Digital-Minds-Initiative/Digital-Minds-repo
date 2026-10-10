import { describe, expect, it } from 'vitest';

import {
  addDays,
  dateOnlyToDate,
  dateToDateOnly,
  isFutureDate,
  todayInAppTimeZone,
} from '../dates';

describe('todayInAppTimeZone', () => {
  it('uses the Saudi calendar date, not UTC', () => {
    // 22:30 UTC on the 9th is already 01:30 on the 10th in Riyadh (UTC+3).
    expect(todayInAppTimeZone(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10');
    expect(todayInAppTimeZone(new Date('2026-10-09T20:59:00Z'))).toBe('2026-10-09');
  });
});

describe('isFutureDate', () => {
  const now = new Date('2026-10-09T22:30:00Z'); // 2026-10-10 in Riyadh

  it('allows today and the past, rejects tomorrow', () => {
    expect(isFutureDate('2026-10-10', now)).toBe(false);
    expect(isFutureDate('2025-01-01', now)).toBe(false);
    expect(isFutureDate('2026-10-11', now)).toBe(true);
  });
});

describe('calendar date helpers', () => {
  it('round-trips a @db.Date value', () => {
    expect(dateToDateOnly(dateOnlyToDate('2026-02-28'))).toBe('2026-02-28');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
