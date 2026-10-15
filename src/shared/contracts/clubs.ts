import { z } from 'zod';

import {
  defineEndpoint,
  entityNameSchema,
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
  requireAnyField,
} from '@/shared/contracts/core';

/*
 * Clubs, their committees and membership types, and each committee's public view-only link.
 *
 * Who may do what (src/server/modules/clubs/policies.ts):
 *   create / rename / archive / restore a club ......... full admin
 *   create / rename / archive / restore a committee .... full admin
 *   membership types of a club ......................... club officer of that club, full admin
 *   read clubs, committees and membership types ........ anyone, limited to their own scope
 *   rotate / disable a view link ....................... club officer of that club, full admin
 *   read a committee's view link ....................... also that committee's lead (to share it)
 *
 * Clubs and committees are never deleted — members and points history depend on them. They are
 * archived instead: hidden from lists by default, closed to new members, committee memberships
 * and points, but fully readable (docs/adr/0015-archive-instead-of-delete.md).
 */

// ─── References embedded in other modules' responses ─────────

export const clubRefSchema = z.object({ id: idSchema, name: z.string(), slug: z.string() });
export type ClubRef = z.infer<typeof clubRefSchema>;

export const committeeRefSchema = z.object({ id: idSchema, name: z.string() });

/** A committee together with its club, for lists that span clubs. */
export const clubCommitteeRefSchema = committeeRefSchema.extend({ clubId: idSchema });
export type ClubCommitteeRef = z.infer<typeof clubCommitteeRefSchema>;

// ─── Shared params and query ─────────────────────────────────

const clubParamsSchema = z.object({ clubId: idSchema });
const committeeParamsSchema = z.object({ committeeId: idSchema });
const membershipTypeParamsSchema = z.object({ membershipTypeId: idSchema });

/**
 * Archived clubs and committees are left out unless asked for. Available to every actor inside
 * their own scope: an officer whose club was archived must still be able to open it.
 */
export const includeArchivedQuerySchema = z.object({
  includeArchived: queryBoolean().default(false),
});
export type IncludeArchivedQuery = z.output<typeof includeArchivedQuerySchema>;

// ─── Clubs ───────────────────────────────────────────────────

/** Fixed at creation: it is the club's stable key and the future `data-brand` value. */
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
  /** Set while the club is archived: read-only, closed to new members and points. */
  archivedAt: isoDateTimeSchema.nullable(),
});
export type Club = z.infer<typeof clubSchema>;

export const createClubBodySchema = z.object({
  name: entityNameSchema,
  slug: clubSlugSchema,
  description: longTextSchema.optional(),
});
export type CreateClubBody = z.output<typeof createClubBodySchema>;

/** Strict: the slug cannot change, so sending it is a 422 instead of being silently dropped. */
export const updateClubBodySchema = requireAnyField(
  z.strictObject({
    name: entityNameSchema.optional(),
    description: longTextSchema.nullable().optional(),
  }),
);
export type UpdateClubBody = z.output<typeof updateClubBodySchema>;

export const listClubsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs',
  access: 'actor',
  query: includeArchivedQuerySchema,
  response: z.object({ items: z.array(clubSchema) }),
});

/**
 * Full admins only. The club starts with one membership type, `عضو`, so officers can add members
 * straight away. 409 `name_taken` / `slug_taken` when either is in use.
 */
export const createClubEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs',
  access: 'actor',
  body: createClubBodySchema,
  response: clubSchema,
  successStatus: 201,
});

/** Full admins only. The slug never changes, so sending it is a 422 (`unrecognized_keys`). */
export const updateClubEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/clubs/:clubId',
  access: 'actor',
  params: clubParamsSchema,
  body: updateClubBodySchema,
  response: clubSchema,
});

/**
 * Full admins only. Idempotent. Archiving a club also closes all of its committees to new
 * members and points; nothing is deleted and nothing about the committees changes.
 */
export const archiveClubEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/archive',
  access: 'actor',
  params: clubParamsSchema,
  response: clubSchema,
});

/** Full admins only. Idempotent. Brings the club back exactly as it was. */
export const restoreClubEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/restore',
  access: 'actor',
  params: clubParamsSchema,
  response: clubSchema,
});

// ─── Committees ──────────────────────────────────────────────

export const committeeSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type Committee = z.infer<typeof committeeSchema>;

export const createCommitteeBodySchema = z.object({
  name: entityNameSchema,
  description: longTextSchema.optional(),
});
export type CreateCommitteeBody = z.output<typeof createCommitteeBodySchema>;

/** Strict: a committee cannot move to another club, so `clubId` is not accepted. */
export const updateCommitteeBodySchema = requireAnyField(
  z.strictObject({
    name: entityNameSchema.optional(),
    description: longTextSchema.nullable().optional(),
  }),
);
export type UpdateCommitteeBody = z.output<typeof updateCommitteeBodySchema>;

/** Committees of archived clubs are left out unless `includeArchived` is set. */
export const listCommitteesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/committees',
  access: 'actor',
  params: clubParamsSchema,
  query: includeArchivedQuerySchema,
  response: z.object({ items: z.array(committeeSchema) }),
});

/** Full admins only. 409 `name_taken` when the club already has a committee with that name. */
export const createCommitteeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/committees',
  access: 'actor',
  params: clubParamsSchema,
  body: createCommitteeBodySchema,
  response: committeeSchema,
  successStatus: 201,
});

/** Full admins only. A committee cannot move to another club, so `clubId` is not editable. */
export const updateCommitteeEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/committees/:committeeId',
  access: 'actor',
  params: committeeParamsSchema,
  body: updateCommitteeBodySchema,
  response: committeeSchema,
});

/** Full admins only. Idempotent. */
export const archiveCommitteeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/archive',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeSchema,
});

/** Full admins only. Idempotent. 409 `club_archived` while the club itself is archived. */
export const restoreCommitteeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/restore',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeSchema,
});

// ─── Membership types ────────────────────────────────────────
// Descriptive levels defined and ordered by each club. They never grant permissions.
// Managed by that club's officers and full admins; committee leads may only read them.

/**
 * The membership type every new club starts with, so its officers can add members before they
 * have defined their own levels. Created with the club (`POST /api/v1/clubs`).
 */
export const DEFAULT_MEMBERSHIP_TYPE_NAME = 'عضو';

export const membershipTypeSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  name: z.string(),
  /** Display order inside the club, ascending and gapless (0, 1, 2…). */
  order: z.number().int().min(0),
  /** Members currently holding this type. Removed memberships are not counted. */
  activeMemberCount: z.number().int().min(0),
  /**
   * Whether any membership still references the type — including removed ones, which keep their
   * type for history. Deleting a type in use needs `moveMembersTo`.
   */
  inUse: z.boolean(),
});
export type MembershipType = z.infer<typeof membershipTypeSchema>;

/** The only editable field; creating and renaming take the same body. */
export const membershipTypeBodySchema = z.strictObject({ name: entityNameSchema });
export type CreateMembershipTypeBody = z.output<typeof membershipTypeBodySchema>;
export type UpdateMembershipTypeBody = z.output<typeof membershipTypeBodySchema>;

export const deleteMembershipTypeQuerySchema = z.object({ moveMembersTo: idSchema.optional() });
export type DeleteMembershipTypeQuery = z.output<typeof deleteMembershipTypeQuerySchema>;

export const reorderMembershipTypesBodySchema = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_ids' }),
});
export type ReorderMembershipTypesBody = z.output<typeof reorderMembershipTypesBodySchema>;

export const listMembershipTypesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/membership-types',
  access: 'actor',
  params: clubParamsSchema,
  response: z.object({ items: z.array(membershipTypeSchema) }),
});

/** Added at the end of the club's order. 409 `name_taken` within the club. */
export const createMembershipTypeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/membership-types',
  access: 'actor',
  params: clubParamsSchema,
  body: membershipTypeBodySchema,
  response: membershipTypeSchema,
  successStatus: 201,
});

export const updateMembershipTypeEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/membership-types/:membershipTypeId',
  access: 'actor',
  params: membershipTypeParamsSchema,
  body: membershipTypeBodySchema,
  response: membershipTypeSchema,
});

/**
 * Deletes the type. Unlike clubs and committees, membership types carry no history of their own,
 * so they can go — but no membership may be left without one:
 *
 * - unused (`inUse: false`) → deleted;
 * - in use → `moveMembersTo` must name another type of the same club; the memberships move and
 *   the type is deleted in one transaction. Without it: 409 `membership_type_in_use`;
 * - the club's last type → 409 `last_membership_type`, always.
 *
 * `moveMembersTo` from another club is a 422 (`membership_type_not_in_club`).
 */
export const deleteMembershipTypeEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/membership-types/:membershipTypeId',
  access: 'actor',
  params: membershipTypeParamsSchema,
  query: deleteMembershipTypeQuerySchema,
  response: null,
});

/**
 * Sets the whole display order in one transaction. `ids` must list every membership type of the
 * club exactly once: a missing id, an extra one or another club's id is a 422 `order_mismatch`,
 * duplicates are a 422 `duplicate_ids`. Concurrent reorders are serialised, so the stored order
 * is always one of the requested ones — never a mix.
 */
export const reorderMembershipTypesEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/clubs/:clubId/membership-types/order',
  access: 'actor',
  params: clubParamsSchema,
  body: reorderMembershipTypesBodySchema,
  response: z.object({ items: z.array(membershipTypeSchema) }),
});

// ─── Committee view-only link ────────────────────────────────
// Draft for task 10 (the committee view link and its token). No routes yet.

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
// Draft for task 10. Members search their own name and read their points history.
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
