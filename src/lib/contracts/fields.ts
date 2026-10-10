import { z } from 'zod';

import { isFutureDate } from '../dates';
import { normalizePhone } from '../phone';

/*
 * Field schemas shared by every module's contracts.
 *
 * Custom validation messages are message *keys* (for example `date_in_future`), not prose.
 * The UI translates them under `common.validation.*`, and API clients can switch on them.
 */

/** Every entity id is a UUID (v7 in practice). Validating it keeps malformed ids away from the DB. */
export const idSchema = z.uuid();

/** Calendar date, `YYYY-MM-DD`. Rejects impossible dates such as 2026-02-30. */
export const isoDateSchema = z.iso.date();

/** Instant, ISO 8601 with offset (the API always sends UTC `…Z`). */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** A calendar date that is today or earlier in Saudi Arabia. */
export const pastOrTodayDateSchema = isoDateSchema.refine((value) => !isFutureDate(value), {
  message: 'date_in_future',
});

/**
 * University email: trimmed and lower-cased. Whether the domain is allowed depends on the
 * ALLOWED_EMAIL_DOMAINS setting, so that check runs on the server (`assertAllowedEmailDomain`).
 */
export const universityEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const personalEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Stored as E.164 (`+9665XXXXXXXX`); accepts the local formats people type. */
export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => normalizePhone(value) !== null, { message: 'invalid_phone' })
  .transform((value) => normalizePhone(value) ?? value);

export const personNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(z.string().min(2).max(120));

/** Academic level (المستوى). */
export const academicLevelSchema = z.number().int().min(1).max(12);

export const shortTextSchema = z.string().trim().min(1).max(120);
export const longTextSchema = z.string().trim().min(1).max(1000);

/** For PATCH bodies whose fields are all optional: rejects an update that changes nothing. */
export function requireAnyField<T extends z.ZodObject>(schema: T) {
  return schema.refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'at_least_one_field',
  });
}

/** Optional work-date period. Spread into a query object and add `refinePeriod`. */
export const periodShape = {
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
};

/** Use with `.superRefine(refinePeriod)` on any object that spreads `periodShape`. */
export function refinePeriod(value: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'period_end_before_start' });
  }
}
