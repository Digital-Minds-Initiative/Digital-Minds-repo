import { z } from 'zod';

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
} from '@/lib/contracts';
import { clubRefSchema, committeeRefSchema } from '@/modules/clubs/contracts';

/*
 * A "member" is a person's membership in ONE club. A person in two clubs is two members with
 * the same `user.id`. The member id in URLs is the membership id.
 *
 * Who may do what (enforced in ./server/policies.ts):
 *   read members .................... officer: the club · lead: members of their committee
 *   add a person .................... officer: any committees · lead: only into their committee
 *   edit profile fields ............. officer · lead (members of their committee)
 *   change membership type .......... officer
 *   add to / remove from committee .. officer · lead (their committee; not other leads)
 *   remove from the club ............ officer
 *   CSV import ...................... officer
 * Full admins can do everything everywhere.
 */

// ─── Roles ───────────────────────────────────────────────────
// Stored on the membership rows this module owns; granted through the permissions module.

export const clubRoleSchema = z.enum(['MEMBER', 'CLUB_OFFICER']);
export type ClubRole = z.infer<typeof clubRoleSchema>;

export const committeeRoleSchema = z.enum(['MEMBER', 'LEAD']);
export type CommitteeRole = z.infer<typeof committeeRoleSchema>;

// ─── Read model ──────────────────────────────────────────────

export const memberCommitteeSchema = committeeRefSchema.extend({ role: committeeRoleSchema });

export const memberSchema = z.object({
  /** Membership id. */
  id: idSchema,
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    uniEmail: z.string(),
    personalEmail: z.string().nullable(),
    phone: z.string().nullable(),
    college: z.string().nullable(),
    major: z.string().nullable(),
    level: z.number().int().nullable(),
    /** False until the person signs up themselves (the account was created by an admin). */
    isRegistered: z.boolean(),
  }),
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

export const newPersonSchema = z.object({
  uniEmail: universityEmailSchema,
  fullName: personNameSchema,
  personalEmail: personalEmailSchema.optional(),
  phone: phoneSchema.optional(),
  college: shortTextSchema.optional(),
  major: shortTextSchema.optional(),
  level: academicLevelSchema.optional(),
});

export const createMemberBodySchema = z.object({
  clubId: idSchema,
  /**
   * Matched by university email. A new email creates an unregistered account that the person
   * claims when they sign up; an existing account is linked as-is (its profile is not overwritten).
   */
  person: newPersonSchema,
  /** Defaults to the club's first membership type. */
  membershipTypeId: idSchema.optional(),
  /** Committees to add the person to. A committee lead must pass only their own committee. */
  committeeIds: z.array(idSchema).max(20).default([]),
});
export type CreateMemberBody = z.output<typeof createMemberBodySchema>;

export const createMemberOutcomeSchema = z.enum([
  /** New account created and added to the club. */
  'created',
  /** Existing account, new to this club. */
  'linked',
  /** Was removed from this club before; membership restored without any previous roles. */
  'reactivated',
  /** Already an active member; only the requested committees were added. */
  'existing',
]);
export type CreateMemberOutcome = z.infer<typeof createMemberOutcomeSchema>;

export const createMemberEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members',
  access: 'actor',
  body: createMemberBodySchema,
  response: z.object({ outcome: createMemberOutcomeSchema, member: memberSchema }),
  successStatus: 201,
});

// ─── Update ──────────────────────────────────────────────────

export const updateMemberBodySchema = requireAnyField(
  z.object({
    /** Only while the person has not registered (409 `uni_email_locked` afterwards). */
    uniEmail: universityEmailSchema.optional(),
    fullName: personNameSchema.optional(),
    personalEmail: personalEmailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    college: shortTextSchema.nullable().optional(),
    major: shortTextSchema.nullable().optional(),
    level: academicLevelSchema.nullable().optional(),
    /** Club officers and full admins only. */
    membershipTypeId: idSchema.optional(),
  }),
);
export type UpdateMemberBody = z.output<typeof updateMemberBodySchema>;

/** Profile fields live on the person's single account, so an edit shows in every club. */
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

export const memberImportRowSchema = z.object({
  /** Line in the file (the header is line 1). */
  line: z.number().int().min(2),
  status: z.enum(['create', 'link', 'reactivate', 'existing', 'invalid']),
  uniEmail: z.string().nullable(),
  fullName: z.string().nullable(),
  issues: z.array(z.object({ field: z.string(), code: z.string() })),
});

export const memberImportSummarySchema = z.object({
  total: z.number().int(),
  create: z.number().int(),
  link: z.number().int(),
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
