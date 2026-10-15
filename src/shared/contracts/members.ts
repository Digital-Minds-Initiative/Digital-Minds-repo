import { z } from 'zod';

import { clubRefSchema, committeeRefSchema } from '@/shared/contracts/clubs';
import {
  academicLevelSchema,
  defineEndpoint,
  idSchema,
  isoDateTimeSchema,
  paginated,
  paginationShape,
  personalEmailSchema,
  personNameSchema,
  phoneSchema,
  queryArray,
  queryBoolean,
  querySearch,
  requireAnyField,
  shortTextSchema,
  sortShape,
  universityEmailSchema,
} from '@/shared/contracts/core';

/*
 * A "member" is a person's membership in ONE club. A person in two clubs is two members with
 * the same `user.id`. The member id in URLs is the membership id.
 *
 * Who may do what (enforced in src/server/modules/members/policies.ts, reasoned in
 * docs/adr/0017-member-permissions.md). Full admins can do everything everywhere:
 *   read and search members ......... officer: the club · lead: members of their committees
 *   add a person to the club ........ officer
 *   edit this club's fields ......... officer        (phone, personal email, college, major, level)
 *   edit the full name .............. officer        (nobody edits their own)
 *   edit the university email ....... officer while the person has not registered; after that a
 *                                     full admin only — and every session of theirs ends
 *   change membership type .......... officer · lead (members of their committees)
 *   add to / remove from committee .. officer
 *   remove from the club ............ officer
 *   CSV import ...................... officer
 */

// ─── Roles ───────────────────────────────────────────────────
// Stored on the membership rows this module owns; granted through the permissions module.

export const clubRoleSchema = z.enum(['MEMBER', 'CLUB_OFFICER']);
export type ClubRole = z.infer<typeof clubRoleSchema>;

export const committeeRoleSchema = z.enum(['MEMBER', 'LEAD']);
export type CommitteeRole = z.infer<typeof committeeRoleSchema>;

// ─── Read model ──────────────────────────────────────────────

export const memberCommitteeSchema = committeeRefSchema.extend({ role: committeeRoleSchema });

/**
 * This club's record of the person's contact and study details. Every club keeps its own copy and
 * never sees another club's (docs/adr/0012-member-profiles-per-club.md).
 */
export const memberProfileSchema = z.object({
  personalEmail: z.string().nullable(),
  phone: z.string().nullable(),
  college: z.string().nullable(),
  major: z.string().nullable(),
  level: z.number().int().nullable(),
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;

export const memberSchema = z.object({
  /** Membership id. */
  id: idSchema,
  /** The person's account: what identifies them to every club they belong to. */
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    uniEmail: z.string(),
    /** False until the person signs up themselves (the account was created by an admin). */
    isRegistered: z.boolean(),
  }),
  profile: memberProfileSchema,
  club: clubRefSchema,
  membershipType: z.object({ id: idSchema, name: z.string(), order: z.number().int() }),
  role: clubRoleSchema,
  /** Active committee memberships — only the committees the caller is allowed to see. */
  committees: z.array(memberCommitteeSchema),
  /** Sum of active point transactions in the committees the caller can see. */
  points: z.number().int(),
  joinedAt: isoDateTimeSchema,
  removedAt: isoDateTimeSchema.nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberParamsSchema = z.object({ memberId: idSchema });
export const memberCommitteeParamsSchema = z.object({ memberId: idSchema, committeeId: idSchema });

// ─── List ────────────────────────────────────────────────────

export const memberStatusSchema = z.enum(['active', 'removed', 'all']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const memberSortFields = ['fullName', 'joinedAt', 'membershipType'] as const;
export type MemberSortField = (typeof memberSortFields)[number];

export const listMembersQuerySchema = z.object({
  ...paginationShape,
  ...sortShape(memberSortFields, { sort: 'fullName', order: 'asc' }),
  /** Name (Arabic-normalised), university email, or phone digits. */
  q: querySearch(),
  clubId: idSchema.optional(),
  /** Members in any of these committees. */
  committeeId: queryArray(idSchema).optional(),
  membershipTypeId: queryArray(idSchema).optional(),
  role: clubRoleSchema.optional(),
  registered: queryBoolean().optional(),
  status: memberStatusSchema.default('active'),
});
export type ListMembersQuery = z.output<typeof listMembersQuerySchema>;
export type ListMembersQueryInput = z.input<typeof listMembersQuerySchema>;

export const listMembersResponseSchema = paginated(memberSchema);
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;

export const listMembersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members',
  access: 'actor',
  query: listMembersQuerySchema,
  response: listMembersResponseSchema,
});

export const getMemberEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members/:memberId',
  access: 'actor',
  params: memberParamsSchema,
  response: memberSchema,
});

// ─── Create ──────────────────────────────────────────────────

/** The shared identity, matched by university email. */
export const newPersonSchema = z.strictObject({
  uniEmail: universityEmailSchema,
  fullName: personNameSchema,
});

/** This club's copy of the person's contact and study details. */
export const newProfileSchema = z.strictObject({
  personalEmail: personalEmailSchema.optional(),
  phone: phoneSchema.optional(),
  college: shortTextSchema.optional(),
  major: shortTextSchema.optional(),
  level: academicLevelSchema.optional(),
});

export const createMemberBodySchema = z.strictObject({
  /**
   * A new email creates an unregistered account that the person claims when they sign up; an
   * existing account is linked and keeps its name.
   */
  person: newPersonSchema,
  /** Saved on the membership this club gets — a new one, or the removed one that is restored. */
  profile: newProfileSchema.default({}),
  /** Defaults to the club's first membership type. */
  membershipTypeId: idSchema.optional(),
  /** Committees to add the person to; a removed committee membership is restored with its points. */
  committeeIds: z.array(idSchema).max(20).default([]),
});
export type CreateMemberBody = z.output<typeof createMemberBodySchema>;

/**
 * 201 with the member, whether the email was new to the platform or already had an account
 * elsewhere, so it never reveals which (docs/adr/0012-member-profiles-per-club.md). A person whose
 * membership in this club was removed is restored with their history.
 *
 * Someone already active in this club is a 409 `already_in_club` whose `error.details.memberId`
 * is that member — nothing is written (docs/adr/0017-member-permissions.md).
 */
export const createMemberEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/members',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  body: createMemberBodySchema,
  response: memberSchema,
  successStatus: 201,
});

// ─── Update ──────────────────────────────────────────────────

export const updateMemberBodySchema = requireAnyField(
  z.strictObject({
    // Shared by every club the person belongs to.
    /** Officers only while the person has not registered; a full admin at any time. */
    uniEmail: universityEmailSchema.optional(),
    /** Officers and full admins; never the person themselves. */
    fullName: personNameSchema.optional(),
    // This club's copy only (officers and full admins). Null clears the field.
    personalEmail: personalEmailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    college: shortTextSchema.nullable().optional(),
    major: shortTextSchema.nullable().optional(),
    level: academicLevelSchema.nullable().optional(),
    /** Officers and full admins; also the lead of a committee this member is in. */
    membershipTypeId: idSchema.optional(),
  }),
);
export type UpdateMemberBody = z.output<typeof updateMemberBodySchema>;

/**
 * The name and university email are the person's shared account, so editing them shows in every
 * club. Contact and study details change only this club's copy.
 *
 * The body is strict: an unknown field is a 422 (`unrecognized_keys`). A field the actor may not
 * change is a 403 naming the rule, and nothing is written — but only when it would really change
 * something: a field whose value already equals the stored one (compared after normalising) is
 * not an edit, so a form that posts every field is not refused over the ones it leaves alone.
 */
export const updateMemberEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/members/:memberId',
  access: 'actor',
  params: memberParamsSchema,
  body: updateMemberBodySchema,
  response: memberSchema,
});

// ─── Remove ──────────────────────────────────────────────────

/**
 * Removes the person from this club only: the membership and its committee memberships are
 * soft-removed and their roles reset. The account, other clubs and points history are untouched.
 */
export const removeMemberEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/members/:memberId',
  access: 'actor',
  params: memberParamsSchema,
  response: null,
});

// ─── Committee assignment ────────────────────────────────────

/** Adds an existing club member to a committee (or restores a removed committee membership). */
export const addMemberToCommitteeEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/members/:memberId/committees/:committeeId',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  response: memberSchema,
});

/** Removes the member from one committee. Points history is kept. */
export const removeMemberFromCommitteeEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/members/:memberId/committees/:committeeId',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  response: null,
});

// ─── CSV import (stateless two-step) ─────────────────────────
// 1. preview: parse + validate + classify every row, return a checksum of the planned changes.
// 2. confirm: send the same input and checksum; the server re-runs the preview and applies it
//    atomically only if the checksum still matches (409 `import_changed` otherwise).

/** Accepted header names per field (English key or Arabic label). */
export const memberImportColumns = {
  fullName: ['fullName', 'الاسم الكامل', 'الاسم'],
  uniEmail: ['uniEmail', 'البريد الجامعي'],
  personalEmail: ['personalEmail', 'البريد الشخصي'],
  phone: ['phone', 'رقم الجوال', 'الجوال'],
  college: ['college', 'الكلية'],
  major: ['major', 'التخصص'],
  level: ['level', 'المستوى'],
  membershipType: ['membershipType', 'نوع العضوية'],
} as const;

export const MEMBER_IMPORT_MAX_BYTES = 1_000_000;
export const MEMBER_IMPORT_MAX_ROWS = 2_000;

export const memberImportBodySchema = z.object({
  clubId: idSchema,
  /** UTF-8 CSV text (BOM allowed). First row is the header. */
  csv: z.string().min(1).max(MEMBER_IMPORT_MAX_BYTES),
  /** Used for rows without a membership type. Defaults to the club's first type. */
  defaultMembershipTypeId: idSchema.optional(),
  /** Committees every imported person is added to. */
  committeeIds: z.array(idSchema).max(20).default([]),
});

/**
 * `add` covers both a new email and an account that already exists in another club, so the
 * preview never reveals which emails have accounts. `reactivate` and `existing` describe this
 * club's own members, which the importing officer can see anyway.
 */
export const memberImportRowSchema = z.object({
  /** Line in the file (the header is line 1). */
  line: z.number().int().min(2),
  status: z.enum(['add', 'reactivate', 'existing', 'invalid']),
  uniEmail: z.string().nullable(),
  fullName: z.string().nullable(),
  issues: z.array(z.object({ field: z.string(), code: z.string() })),
});

export const memberImportSummarySchema = z.object({
  total: z.number().int(),
  add: z.number().int(),
  reactivate: z.number().int(),
  existing: z.number().int(),
  invalid: z.number().int(),
});

export const previewMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/import/preview',
  access: 'actor',
  body: memberImportBodySchema,
  response: z.object({
    /** SHA-256 of the planned changes; send it back to confirm. */
    checksum: z.string().length(64),
    summary: memberImportSummarySchema,
    rows: z.array(memberImportRowSchema),
  }),
});

/** Invalid rows are skipped; everything else is applied in one transaction. */
export const confirmMemberImportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/import/confirm',
  access: 'actor',
  body: memberImportBodySchema.extend({ checksum: z.string().length(64) }),
  response: z.object({ summary: memberImportSummarySchema }),
  successStatus: 201,
});
