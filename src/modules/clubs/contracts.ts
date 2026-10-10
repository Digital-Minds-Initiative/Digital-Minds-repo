import { z } from 'zod';

import {
  defineEndpoint,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  longTextSchema,
  paginated,
  paginationShape,
  periodShape,
  querySearch,
  queryBoolean,
  refinePeriod,
  shortTextSchema,
} from '@/lib/contracts';

/*
 * Clubs, their committees and membership types, and each committee's public view-only link.
 *
 * Who may do what (enforced in ./server/policies.ts):
 *   create / archive clubs ............ full admin
 *   edit club details ................. club officer of that club, full admin
 *   committees, membership types ...... club officer of that club, full admin
 *   rotate / disable a view link ...... club officer of that club, full admin
 *   read a committee's view link ...... also that committee's lead (to share it)
 */

// ─── Clubs ───────────────────────────────────────────────────

export const clubSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'invalid_slug' });

export const clubSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type Club = z.infer<typeof clubSchema>;

const clubParamsSchema = z.object({ clubId: idSchema });
const includeArchivedQuerySchema = z.object({ includeArchived: queryBoolean().default(false) });

export const listClubsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs',
  access: 'actor',
  query: includeArchivedQuerySchema,
  response: z.object({ items: z.array(clubSchema) }),
});

export const createClubEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs',
  access: 'actor',
  body: z.object({
    name: shortTextSchema,
    slug: clubSlugSchema,
    description: longTextSchema.optional(),
    /** Initial membership types, in display order (e.g. ["مستفيد", "عضو فعال"]). */
    membershipTypes: z.array(shortTextSchema).min(1).max(20),
  }),
  response: clubSchema,
  successStatus: 201,
});

export const getClubEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId',
  access: 'actor',
  params: clubParamsSchema,
  response: clubSchema,
});

export const updateClubEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/clubs/:clubId',
  access: 'actor',
  params: clubParamsSchema,
  body: z
    .object({
      name: shortTextSchema.optional(),
      description: longTextSchema.nullable().optional(),
      /** Archiving makes the club read-only; full admins only. */
      archived: z.boolean().optional(),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: 'at_least_one_field',
    }),
  response: clubSchema,
});

// ─── Committees ──────────────────────────────────────────────

export const committeeSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  /** Whether a public view-only link is currently enabled. */
  hasViewLink: z.boolean(),
});
export type Committee = z.infer<typeof committeeSchema>;

const committeeParamsSchema = z.object({ committeeId: idSchema });

export const listCommitteesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/committees',
  access: 'actor',
  params: clubParamsSchema,
  query: includeArchivedQuerySchema,
  response: z.object({ items: z.array(committeeSchema) }),
});

export const createCommitteeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/committees',
  access: 'actor',
  params: clubParamsSchema,
  body: z.object({ name: shortTextSchema, description: longTextSchema.optional() }),
  response: committeeSchema,
  successStatus: 201,
});

export const updateCommitteeEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/committees/:committeeId',
  access: 'actor',
  params: committeeParamsSchema,
  body: z
    .object({
      name: shortTextSchema.optional(),
      description: longTextSchema.nullable().optional(),
      /** Archived committees are read-only and their public link stops working. */
      archived: z.boolean().optional(),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: 'at_least_one_field',
    }),
  response: committeeSchema,
});

// ─── Membership types ────────────────────────────────────────
// Descriptive levels defined and ordered by each club. They never grant permissions.

export const membershipTypeSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  name: z.string(),
  order: z.number().int().min(0),
  /** Active members currently holding this type. */
  memberCount: z.number().int().min(0),
});
export type MembershipType = z.infer<typeof membershipTypeSchema>;

const membershipTypeParamsSchema = z.object({ membershipTypeId: idSchema });

export const listMembershipTypesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/membership-types',
  access: 'actor',
  params: clubParamsSchema,
  response: z.object({ items: z.array(membershipTypeSchema) }),
});

/** Adds a type at the end of the club's order. */
export const createMembershipTypeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/membership-types',
  access: 'actor',
  params: clubParamsSchema,
  body: z.object({ name: shortTextSchema }),
  response: membershipTypeSchema,
  successStatus: 201,
});

export const updateMembershipTypeEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/membership-types/:membershipTypeId',
  access: 'actor',
  params: membershipTypeParamsSchema,
  body: z.object({ name: shortTextSchema }),
  response: membershipTypeSchema,
});

/** 409 `membership_type_in_use` while any membership (including removed ones) still uses it. */
export const deleteMembershipTypeEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/membership-types/:membershipTypeId',
  access: 'actor',
  params: membershipTypeParamsSchema,
  response: null,
});

/** Sets the full display order. `ids` must list every type of the club exactly once. */
export const reorderMembershipTypesEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/clubs/:clubId/membership-types/order',
  access: 'actor',
  params: clubParamsSchema,
  body: z.object({
    ids: z
      .array(idSchema)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_ids' }),
  }),
  response: z.object({ items: z.array(membershipTypeSchema) }),
});

// ─── Committee view-only link ────────────────────────────────

/** 32 URL-safe characters (192 random bits). */
export const viewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

export const committeeViewLinkSchema = z.object({
  /** Null when the link is disabled. The public page lives at /v/<token>. */
  token: viewTokenSchema.nullable(),
  rotatedAt: isoDateTimeSchema.nullable(),
});
export type CommitteeViewLink = z.infer<typeof committeeViewLinkSchema>;

export const getCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/committees/:committeeId/view-link',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeViewLinkSchema,
});

/** Creates the link, or replaces it so the old link stops working immediately. */
export const rotateCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/view-link/rotate',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeViewLinkSchema,
});

export const disableCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/committees/:committeeId/view-link',
  access: 'actor',
  params: committeeParamsSchema,
  response: null,
});

// ─── Public committee view (no login) ────────────────────────
// Members search their own name and read their points history.
// NEVER add contact data (phone, emails) or internal user ids to these schemas: responses are
// parsed through them, so anything not listed here is stripped before it leaves the server.

/** User.publicId (cuid2). */
export const publicIdSchema = z.string().regex(/^[a-z0-9]{20,40}$/);

const publicViewParamsSchema = z.object({ token: viewTokenSchema });

export const publicCommitteeViewEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token',
  access: 'public',
  params: publicViewParamsSchema,
  response: z.object({
    committee: z.object({ name: z.string() }),
    club: z.object({ name: z.string(), slug: z.string() }),
  }),
});

/** Name search only (never email or phone), at least 2 characters, at most 20 results. */
export const searchPublicCommitteeMembersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token/members',
  access: 'public',
  params: publicViewParamsSchema,
  query: z.object({ q: z.string().trim().min(2).max(60) }),
  response: z.object({
    items: z
      .array(
        z.object({ publicId: publicIdSchema, fullName: z.string(), balance: z.number().int() }),
      )
      .max(20),
  }),
});

/** Active transactions only; cancelled ones are not shown publicly. */
export const publicMemberPointsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token/members/:publicId/points',
  access: 'public',
  params: publicViewParamsSchema.extend({ publicId: publicIdSchema }),
  query: z
    .object({ ...paginationShape, ...periodShape, q: querySearch() })
    .superRefine(refinePeriod),
  response: z.object({
    member: z.object({ publicId: publicIdSchema, fullName: z.string() }),
    totals: z.object({ balance: z.number().int(), period: z.number().int() }),
    transactions: paginated(
      z.object({ amount: z.number().int(), reason: z.string(), workDate: isoDateSchema }),
    ),
  }),
});
