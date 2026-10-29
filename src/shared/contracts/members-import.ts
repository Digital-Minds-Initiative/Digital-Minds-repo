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
 * club coming from the URL, so a file can never reach another club. A committee lead cannot
 * import into the club (403 `club_management_required`); they import into a committee they lead,
 * through the committee endpoints at the end of this file.
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
  gender: ['الجنس', 'gender'],
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
 * row. `code` is machine-readable and translated by the UI.
 *
 * `value` is the cell text the code is about — the committee name that matched nothing, say — so
 * the officer can see which of five committees in the cell is the problem. It is always something
 * from their own file, never anything read from the database.
 */
export const memberImportIssueSchema = z.object({
  field: z.string(),
  code: z.string(),
  value: z.string().optional(),
  /** `duplicate_in_file` only: the line this email was first used on. */
  at: z.number().int().optional(),
});
export type MemberImportIssue = z.infer<typeof memberImportIssueSchema>;

/**
 * What the row will do.
 *
 * `add` covers an email nobody has **and** an account that already exists in another club, so the
 * preview never reveals which emails have accounts (docs/adr/0012-member-profiles-per-club.md).
 * `restore`, `join` and `existing` describe this club's own members, whom the importing officer
 * sees anyway. `join` is an active member whose committees cell names committees they are not
 * active in: only those committee memberships are written, never the membership itself.
 */
export const memberImportStatusSchema = z.enum(['add', 'restore', 'join', 'existing', 'invalid']);
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
  /**
   * Worth seeing, but the row still imports. Today the only one is `name_differs`: this club has
   * a different name on record and keeps it. It appears on `restore`, `join` and `existing` rows
   * only — on an `add` row the stored name belongs to an account outside the club, which the
   * officer may not see (docs/adr/0021-csv-member-import.md).
   */
  warnings: z.array(memberImportIssueSchema),
  /**
   * `join` rows only: the committees the member will be added to or brought back into, by their
   * names on record. Committees the member is already active in are not listed.
   */
  joinCommittees: z.array(z.string()).optional(),
});
export type MemberImportRow = z.infer<typeof memberImportRowSchema>;

export const memberImportSummarySchema = z.object({
  total: z.number().int(),
  add: z.number().int(),
  restore: z.number().int(),
  join: z.number().int(),
  existing: z.number().int(),
  invalid: z.number().int(),
});
export type MemberImportSummary = z.infer<typeof memberImportSummarySchema>;

/**
 * `membership_type_ignored`: a committee import gives every new or restored person the club's
 * «عضو» type, and the file filled in a type column anyway (docs/adr/0029-leads-add-members.md).
 */
export const memberImportNoticeSchema = z.enum(['membership_type_ignored']);
export type MemberImportNotice = z.infer<typeof memberImportNoticeSchema>;

export const previewMemberImportResponseSchema = z.object({
  /**
   * SHA-256 of the planned changes — send it back to import. It covers what the preview showed
   * and what each row would write, so both a change in the club and an edit to the file are
   * caught (docs/adr/0021-csv-member-import.md).
   */
  checksum: z.string().length(64),
  /** Header names that are not columns of ours; their values are ignored. */
  ignoredColumns: z.array(z.string()),
  /** About the whole file. Empty for an import into a club. */
  notices: z.array(memberImportNoticeSchema),
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
  /** Rows of active members who were added to committees (rows, not committee memberships). */
  joined: z.number().int(),
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
 * `invalid` and `existing` rows are skipped, and a `join` row writes only its committee
 * memberships; every other row is applied in one transaction, so a
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

// ─── Into one committee (docs/adr/0029-leads-add-members.md) ─

/*
 * The same two steps and the same file, for one committee: its leads, the club's officers and
 * full admins, with the committee from the URL. Every row that writes goes into that committee —
 * a new person, a removed member (restored), an active member who is not in it yet (`join`) —
 * and new or restored people get the club's «عضو» type:
 *
 *   - the committees cell may be empty or name this committee; any other name makes the row
 *     `invalid` with `committee_not_target`;
 *   - the type column is ignored, and the preview says so with `membership_type_ignored`;
 *   - an active member's profile, type and name are never touched, as in the club import.
 *
 * A committee outside the actor's scope is a 404; an archived club or committee is 409
 * `club_archived` / `committee_archived`; a club without a «عضو» type is 409
 * `member_type_missing`. A checksum from the club import is not valid here (409
 * `import_changed`), nor the other way round.
 */

const committeeImportParamsSchema = z.object({ committeeId: idSchema });

export const previewCommitteeMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/members/import/preview',
  access: 'actor',
  params: committeeImportParamsSchema,
  body: memberImportBodySchema,
  response: previewMemberImportResponseSchema,
});

export const confirmCommitteeMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/members/import',
  access: 'actor',
  params: committeeImportParamsSchema,
  body: confirmMemberImportBodySchema,
  response: memberImportResultSchema,
  successStatus: 201,
});

/** The same template as the club's: a committees column is welcome but may stay empty. */
export const committeeMemberImportTemplateEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/committees/:committeeId/members/import/template',
  access: 'actor',
  params: committeeImportParamsSchema,
  response: z.string(),
});
