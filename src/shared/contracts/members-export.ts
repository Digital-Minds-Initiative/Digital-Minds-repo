import { z } from 'zod';

import { defineEndpoint, idSchema, refinePeriod } from '@/shared/contracts/core';
import { memberListFiltersShape, withMemberSortDefaults } from '@/shared/contracts/members';

/*
 * Exporting a club's members to an Excel file (docs/adr/0025-members-export.md).
 *
 * Who: anyone who can list the club's members, and a file never holds a member or a field the
 * same actor could not see in the list — a lead exports the members of the committees they lead,
 * an officer their club, a full admin any club. An actor who cannot list any member of the club
 * (an ordinary member, an officer of another club) gets a 404 for the club.
 *
 * What: the columns the caller picks, in the order they picked them, for either every member the
 * list's filters match or the members ticked in the table. Ticked members are checked against the
 * same filters and scope: if any of them is not in that list, nothing is exported and every one
 * of them is named (422 `entries_rejected`), the way bulk points refuses.
 */

/** Rows one file may hold. More is a 422 `too_many_rows`, decided before the file is built. */
export const MEMBER_EXPORT_MAX_ROWS = 5000;
/** Rejected ids one 422 lists, as bulk points does. */
export const MEMBER_EXPORT_MAX_ISSUES = 1000;

export const MEMBER_EXPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The columns a file can have — the members table's. Their Arabic headers are in
 * src/i18n/messages/ar/membersExport.json, and the ones the CSV import knows use the import's own
 * header names, so a file saved as CSV UTF-8 can be imported again.
 */
export const memberExportColumns = [
  'fullName',
  'uniEmail',
  'phone',
  'personalEmail',
  'college',
  'major',
  'level',
  'membershipType',
  'role',
  'committees',
  'points',
  'joinedAt',
  'registered',
  'status',
] as const;
export const memberExportColumnSchema = z.enum(memberExportColumns);
export type MemberExportColumn = z.infer<typeof memberExportColumnSchema>;

/** The list's filters and sort, as a JSON object instead of a query string. */
export const memberExportFiltersSchema = z
  .strictObject(memberListFiltersShape)
  .superRefine(refinePeriod)
  .transform(withMemberSortDefaults);
export type MemberExportFilters = z.output<typeof memberExportFiltersSchema>;

export const memberExportSelectionSchema = z.discriminatedUnion('kind', [
  /** Every member the filters match. */
  z.strictObject({ kind: z.literal('all') }),
  /** The members ticked in the table — each one must also be in the filtered list. */
  z.strictObject({
    kind: z.literal('ids'),
    memberIds: z
      .array(idSchema)
      .min(1)
      .max(MEMBER_EXPORT_MAX_ROWS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_ids' }),
  }),
]);
export type MemberExportSelection = z.output<typeof memberExportSelectionSchema>;

export const memberExportBodySchema = z.strictObject({
  columns: z
    .array(memberExportColumnSchema)
    .min(1)
    .max(memberExportColumns.length)
    .refine((columns) => new Set(columns).size === columns.length, { message: 'duplicate_ids' }),
  /** The table's current filters. They decide the rows, their order and which points count. */
  filters: memberExportFiltersSchema.prefault({}),
  selection: memberExportSelectionSchema,
});
export type MemberExportBody = z.output<typeof memberExportBodySchema>;
export type MemberExportBodyInput = z.input<typeof memberExportBodySchema>;

/**
 * Answers with the `.xlsx` file itself, not JSON: `Content-Disposition: attachment` with an ASCII
 * name (`members-<club slug>-<date>.xlsx`) and an Arabic one in `filename*`, and
 * `Cache-Control: no-store`. POST because the body can carry 5000 ids.
 *
 * Refusals are the usual JSON envelope:
 *   404 — the club, or a committee or membership type in the filters, is out of the actor's reach
 *   422 — the body fails the contract (an unknown or repeated column, a repeated id:
 *         `duplicate_ids`); a committee or type from another club (`committee_not_in_club`,
 *         `membership_type_not_in_club`); ticked members outside the list (`entries_rejected`,
 *         one `not_found` issue per id at `body.selection.memberIds[i]`); more than
 *         MEMBER_EXPORT_MAX_ROWS rows (`too_many_rows` at `body.selection`)
 *   429 — `too_many_requests`, with `Retry-After`
 */
export const memberExportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/members/export',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  body: memberExportBodySchema,
  response: z.instanceof(Uint8Array),
});
