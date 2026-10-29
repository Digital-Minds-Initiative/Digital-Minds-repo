import { z } from 'zod';

import { clubRefSchema, committeeRefSchema } from '@/shared/contracts/clubs';
import {
  academicLevelSchema,
  defineEndpoint,
  genderSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  paginated,
  paginationShape,
  periodShape,
  personalEmailSchema,
  personNameSchema,
  phoneSchema,
  queryArray,
  queryBoolean,
  querySearch,
  refinePeriod,
  requireAnyField,
  shortTextSchema,
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
 *   edit this club's fields ......... officer        (phone, personal email, college, major, level, gender)
 *   edit the full name .............. officer        (nobody edits their own)
 *   edit the university email ....... officer while the person has not registered; after that a
 *                                     full admin only — and every session of theirs ends
 *   change membership type .......... officer · lead (members of their committees)
 *   add to / remove from committee .. officer
 *   remove from the club ............ officer
 *   CSV import ...................... officer   (its own contract: members-import.ts)
 */

// ─── Roles ───────────────────────────────────────────────────
// Stored on the membership rows this module owns; granted through the permissions module.

export const clubRoleSchema = z.enum(['MEMBER', 'CLUB_OFFICER']);
export type ClubRole = z.infer<typeof clubRoleSchema>;

export const committeeRoleSchema = z.enum(['MEMBER', 'LEAD']);
export type CommitteeRole = z.infer<typeof committeeRoleSchema>;

// ─── Read model ──────────────────────────────────────────────

export const memberCommitteeSchema = committeeRefSchema.extend({
  role: committeeRoleSchema,
  /** The member's balance in this committee: the sum of its active transactions. */
  points: z.number().int(),
});

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
  gender: genderSchema.nullable(),
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
  /**
   * The member's balance across every committee the caller can see — which can be more than the
   * committees listed above add up to, because points earned in a committee the person has since
   * left still count for the club (docs/adr/0017-member-permissions.md).
   */
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

/** The gender filter: one recorded value, or the members with none. */
export const memberGenderFilterSchema = z.enum([...genderSchema.options, 'UNSPECIFIED']);
export type MemberGenderFilter = z.infer<typeof memberGenderFilterSchema>;

/**
 * `fullName` sorts on the Arabic-folded `searchName`, so names that differ only in أ/إ/آ or
 * ة/ه sit together (docs/adr/0020-members-list-filtering.md). `points` sorts by the figure the
 * list is showing — with a period filter, that period's points.
 */
export const memberSortFields = ['fullName', 'joinedAt', 'membershipType', 'points'] as const;
export type MemberSortField = (typeof memberSortFields)[number];

/**
 * Every filter is ANDed and every one stays inside the actor's scope — a filter can only narrow
 * what someone already sees. A club, committee or membership type the actor cannot see is a 404;
 * one belonging to a different club than the rest of the request implies is a 422.
 *
 * `sort` and `order` are optional because their defaults depend on the rest of the query: with
 * a work-date period the question being asked is "who earned the most", so the default becomes
 * points descending instead of name ascending.
 *
 * The list and the export (members-export.ts) share these fields, so a file holds exactly the
 * rows the table showed. The club is not among them: the export takes it from its URL.
 */
export const memberListFiltersShape = {
  sort: z.enum(memberSortFields).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  /** Work-date period for the points shown; it never removes a member from the list. */
  ...periodShape,
  /** Name (Arabic-normalised), university email, or phone digits. */
  q: querySearch(),
  /** One committee: members currently in it, and its points in the column. */
  committeeId: idSchema.optional(),
  membershipTypeId: queryArray(idSchema).optional(),
  role: clubRoleSchema.optional(),
  registered: queryBoolean().optional(),
  /** A recorded gender, or `UNSPECIFIED` for members whose club recorded none. */
  gender: memberGenderFilterSchema.optional(),
  status: memberStatusSchema.default('active'),
};

/** The defaults `sort` and `order` take from the rest of the filters. */
export function withMemberSortDefaults<
  T extends { sort?: MemberSortField; order?: 'asc' | 'desc'; from?: string; to?: string },
>(filters: T): T & { sort: MemberSortField; order: 'asc' | 'desc' } {
  const hasPeriod = filters.from !== undefined || filters.to !== undefined;
  const sort = filters.sort ?? (hasPeriod ? 'points' : 'fullName');
  return { ...filters, sort, order: filters.order ?? (sort === 'points' ? 'desc' : 'asc') };
}

export const listMembersQuerySchema = z
  .object({
    ...paginationShape,
    ...memberListFiltersShape,
    clubId: idSchema.optional(),
  })
  .superRefine(refinePeriod)
  .transform(withMemberSortDefaults);
export type ListMembersQuery = z.output<typeof listMembersQuerySchema>;
export type ListMembersQueryInput = z.input<typeof listMembersQuerySchema>;

/**
 * Which points the list is showing, so the column can be labelled without guessing: a committee
 * when one is filtered on, and the work-date bounds when a period is. All three null means every
 * committee the caller can see, all time.
 */
export const memberPointsBasisSchema = z.object({
  committee: committeeRefSchema.nullable(),
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
});
export type MemberPointsBasis = z.infer<typeof memberPointsBasisSchema>;

export const listMembersResponseSchema = paginated(memberSchema).extend({
  pointsBasis: memberPointsBasisSchema,
});
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
  gender: genderSchema.optional(),
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

/**
 * The name of the membership type a person gets when they are brought in through one committee,
 * matched like every entity name (exactly, then on the Arabic-folded spelling). A club without
 * one refuses with 409 `member_type_missing` (docs/adr/0029-leads-add-members.md).
 */
export const COMMITTEE_ADMISSION_TYPE_NAME = 'عضو';

/** No type and no committees: the type is always the club's «عضو», the committee the URL's. */
export const admitMemberBodySchema = z.strictObject({
  person: newPersonSchema,
  /** Saved only when the person gets a new or restored membership; an active member keeps theirs. */
  profile: newProfileSchema.default({}),
});
export type AdmitMemberBody = z.output<typeof admitMemberBodySchema>;

/**
 * Brings a person into one committee — its leads, the club's officers and full admins
 * (docs/adr/0029-leads-add-members.md). Always 201 with the member:
 *
 *   - no membership in the club (a new address, or an account in another club — never told
 *     apart, docs/adr/0012) → a new membership with the club's «عضو» type, in this committee;
 *   - a removed membership → restored by id with «عضو» and role MEMBER, in this committee only;
 *   - an active member not in this committee → joins it (a removed committee membership comes back
 *     by id, role MEMBER); their type, profile and name are not touched.
 *
 * Already active in this committee is 409 `already_in_committee` with `error.details.memberId`.
 * A club without a «عضو» type is 409 `member_type_missing`. A membership type or committees in
 * the body are 422 (`unrecognized_keys`).
 */
export const admitMemberEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/members',
  access: 'actor',
  params: z.object({ committeeId: idSchema }),
  body: admitMemberBodySchema,
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
    gender: genderSchema.nullable().optional(),
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
