import { z } from 'zod';

import { defineEndpoint, idSchema } from '@/shared/contracts/core';

/*
 * Importing a club's members from a CSV file, in two steps that share one body
 * (docs/adr/0021-csv-member-import.md):
 *
 *   1. preview — decode, parse, validate and classify every row; write nothing; answer with the
 *      per-row result and a checksum of the planned changes;
 *   2. import  — send the same file with that checksum. The server redoes the whole preview and
 *      applies it in one transaction only if the new checksum is identical, so an officer can
 *      never confirm something other than what they saw (409 `import_changed` otherwise).
 *
 * Who: the club's officers and full admins — the same rule as adding one member, including the
 * club coming from the URL, so a file can never reach another club. Committee leads cannot
 * import (403 `club_management_required`).
 */

// ─── The file ────────────────────────────────────────────────

/** Decoded size. The body carries the file base64-encoded, so it is ~4/3 of this. */
export const MEMBER_IMPORT_MAX_BYTES = 1_000_000;
/** Base64 length of a file of MEMBER_IMPORT_MAX_BYTES: ceil(n / 3) * 4. */
export const MEMBER_IMPORT_MAX_BASE64 = Math.ceil(MEMBER_IMPORT_MAX_BYTES / 3) * 4;
/** Data rows, the header excluded. */
export const MEMBER_IMPORT_MAX_ROWS = 1000;
/** Committees one row may name, matching `createMemberBodySchema.committeeIds`. */
export const MEMBER_IMPORT_MAX_COMMITTEES = 20;

/**
 * Accepted header names per field: the Arabic labels of the members table, and the English field
 * names so a file produced by a script works too. Matched after collapsing whitespace. The first
 * Arabic label of each field is the one the template writes.
 */
export const memberImportColumns = {
  fullName: ['الاسم الكامل', 'الاسم', 'fullName'],
  uniEmail: ['البريد الجامعي', 'uniEmail'],
  phone: ['رقم الجوال', 'الجوال', 'phone'],
  personalEmail: ['البريد الشخصي', 'personalEmail'],
  college: ['الكلية', 'college'],
  major: ['التخصص', 'major'],
  level: ['المستوى', 'level'],
  membershipType: ['نوع العضوية', 'membershipType'],
  committees: ['اللجان', 'اللجنة', 'committees'],
} as const;

export type MemberImportField = keyof typeof memberImportColumns;

/** Without these two a row cannot identify a person, so the whole file is refused. */
export const memberImportRequiredColumns = ['fullName', 'uniEmail'] as const;

// ─── Request ─────────────────────────────────────────────────

/**
 * The file travels base64-encoded inside the JSON body, which keeps the CSRF rule intact (bodies
 * are `application/json` only) and — the reason it is not a plain string — leaves the server with
 * the exact bytes, so a file Excel saved in another encoding is detected instead of imported as
 * mojibake (422 `unsupported_encoding`).
 */
export const memberImportBodySchema = z.strictObject({
  file: z.string().min(1).max(MEMBER_IMPORT_MAX_BASE64),
});
export type MemberImportBody = z.output<typeof memberImportBodySchema>;

export const confirmMemberImportBodySchema = memberImportBodySchema.extend({
  /** The `checksum` the preview answered with. */
  checksum: z.string().length(64),
});

// ─── Per-row result ──────────────────────────────────────────

/**
 * `field` is a column (`uniEmail`, `phone`, `committees`…) or `row` for something about the whole
 * row. `code` is machine-readable and translated by the UI; `at` is the line a duplicate first
 * appeared on.
 */
export const memberImportIssueSchema = z.object({
  field: z.string(),
  code: z.string(),
  at: z.number().int().optional(),
});
export type MemberImportIssue = z.infer<typeof memberImportIssueSchema>;

/**
 * What the row will do.
 *
 * `add` covers an email nobody has **and** an account that already exists in another club, so the
 * preview never reveals which emails have accounts (docs/adr/0012-member-profiles-per-club.md).
 * `existing` and `restore` describe this club's own members, whom the importing officer sees
 * anyway.
 */
export const memberImportStatusSchema = z.enum(['add', 'restore', 'existing', 'invalid']);
export type MemberImportStatus = z.infer<typeof memberImportStatusSchema>;

export const memberImportRowSchema = z.object({
  /** The line as the officer's spreadsheet numbers it: the header is line 1. */
  line: z.number().int().min(2),
  status: memberImportStatusSchema,
  /** Normalised, or null when the cell was empty or not an email at all. */
  uniEmail: z.string().nullable(),
  /**
   * The name this row will end up with: the file's for `add`, the stored one for a member of this
   * club. Null when the cell was empty.
   */
  fullName: z.string().nullable(),
  /** Everything wrong with the row, not just the first thing. Any issue makes it `invalid`. */
  issues: z.array(memberImportIssueSchema),
  /** Worth seeing, but the row still imports (`name_differs`, `already_member`). */
  warnings: z.array(memberImportIssueSchema),
});
export type MemberImportRow = z.infer<typeof memberImportRowSchema>;

export const memberImportSummarySchema = z.object({
  total: z.number().int(),
  add: z.number().int(),
  restore: z.number().int(),
  existing: z.number().int(),
  invalid: z.number().int(),
});
export type MemberImportSummary = z.infer<typeof memberImportSummarySchema>;

export const previewMemberImportResponseSchema = z.object({
  /**
   * SHA-256 of the planned changes — send it back to import. It covers what the preview showed
   * and what each row would write, so both a change in the club and an edit to the file are
   * caught (docs/adr/0021-csv-member-import.md).
   */
  checksum: z.string().length(64),
  /** Header names that are not columns of ours; their values are ignored. */
  ignoredColumns: z.array(z.string()),
  summary: memberImportSummarySchema,
  rows: z.array(memberImportRowSchema),
});
export type PreviewMemberImportResponse = z.infer<typeof previewMemberImportResponseSchema>;

/**
 * What the import wrote. `added` is "created or linked" for the same reason `add` is one status:
 * a count of created accounts would say which emails were new (ADR 0012).
 */
export const memberImportResultSchema = z.object({
  added: z.number().int(),
  restored: z.number().int(),
  skippedExisting: z.number().int(),
  skippedInvalid: z.number().int(),
});
export type MemberImportResult = z.infer<typeof memberImportResultSchema>;

// ─── Endpoints ───────────────────────────────────────────────

const importParamsSchema = z.object({ clubId: idSchema });

/**
 * Writes nothing. Refusals about the file itself are 422 (`unsupported_encoding`,
 * `file_too_large`, `too_many_rows`, `missing_column` — whose issue path names the column —
 * `unparsable_csv`); an archived club is 409 `club_archived`, as it is for a single add.
 */
export const previewMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/members/import/preview',
  access: 'actor',
  params: importParamsSchema,
  body: memberImportBodySchema,
  response: previewMemberImportResponseSchema,
});

/**
 * `invalid` and `existing` rows are skipped; every other row is applied in one transaction, so a
 * failure leaves nothing behind. A row whose state changed since the preview — someone else added
 * that person, a committee was renamed, the file was edited — refuses the whole import with 409
 * `import_changed`, and the client previews again.
 *
 * No email is sent to an imported person; they meet the platform when they sign in.
 */
export const confirmMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/members/import',
  access: 'actor',
  params: importParamsSchema,
  body: confirmMemberImportBodySchema,
  response: memberImportResultSchema,
  successStatus: 201,
});

/**
 * The empty file to fill in: one header row, UTF-8 **with a BOM**, so Excel on Windows opens the
 * Arabic headers correctly instead of asking. Sent as `text/csv`, not JSON — the response schema
 * is the file's text (see `withFile` in src/server/http), so it is downloaded with a link rather
 * than through the API client.
 */
export const memberImportTemplateEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/members/import/template',
  access: 'actor',
  params: importParamsSchema,
  response: z.string(),
});
