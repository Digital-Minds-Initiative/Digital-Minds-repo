import { z } from 'zod';

import { isFutureDate } from '@/shared/lib/dates';
import { normalizeEmail } from '@/shared/lib/email-domains';
import { normalizeEntityName, normalizePersonName } from '@/shared/lib/names';
import { normalizePhone } from '@/shared/lib/phone';
import { collapseWhitespace } from '@/shared/lib/text';

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
 * ALLOWED_EMAIL_DOMAINS setting, so that check runs on the server (`assertUniversityEmail` in
 * src/server/email-policy.ts).
 */
export const universityEmailSchema = z.string().transform(normalizeEmail).pipe(z.email().max(254));

export const personalEmailSchema = z.string().transform(normalizeEmail).pipe(z.email().max(254));

/** Stored as E.164 (`+9665XXXXXXXX`); accepts the local formats people type. */
export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => normalizePhone(value) !== null, { message: 'invalid_phone' })
  .transform((value) => normalizePhone(value) ?? value);

/** A person's full name, spacing normalised with `normalizePersonName` (applied again in services). */
export const personNameSchema = z
  .string()
  .transform(normalizePersonName)
  .pipe(z.string().min(2).max(120));

/** Academic level (المستوى). */
export const academicLevelSchema = z.number().int().min(1).max(12);

/**
 * Free text somebody types: a college, a major, a description. Whitespace is collapsed, not just
 * trimmed, so the same words typed with a double space are the same value — the CSV import
 * already normalised its cells this way (ADR 0021), and the form has to agree with it, or a value
 * means something different depending on which door it came through.
 */
export const shortTextSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(z.string().min(1).max(120));
export const longTextSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(z.string().min(1).max(1000));

/**
 * The name of something that must be unique among its siblings (a club, a committee in a club, a
 * membership type in a club). Normalised with `normalizeEntityName`, which the services apply
 * again before they compare or store a name.
 */
export const entityNameSchema = z
  .string()
  .transform(normalizeEntityName)
  .pipe(z.string().min(1).max(120));

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
