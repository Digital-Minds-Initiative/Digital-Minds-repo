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
  queryBoolean,
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
 *   create / renew / turn off a view link .............. that committee's lead, its club's
 *                                                        officers, full admins
 *   read a committee's view link ....................... the same three (to copy and share it)
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

export const createClubBodySchema = z.strictObject({
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

export const createCommitteeBodySchema = z.strictObject({
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

export const reorderMembershipTypesBodySchema = z.strictObject({
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
// Every committee can have one view-only link, which anyone may open without signing in
// (docs/adr/0023-committee-view-link.md). The link is created, renewed and turned off by the
// committee's lead, the club's officers and full admins; everyone else gets a 404.

/** 32 URL-safe characters (192 random bits), from a cryptographically secure source. */
export const viewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

/** Where the public page lives, under APP_ORIGIN: `https://…/v/<token>`. */
export const VIEW_LINK_PATH = '/v';

export const committeeViewLinkSchema = z.object({
  /**
   * The whole link, built by the server from APP_ORIGIN so no client has to assemble it.
   * Null (with the other two) when the committee has no active link.
   */
  url: z.url().nullable(),
  token: viewTokenSchema.nullable(),
  /** When this link was created — by the first creation or by the latest renewal. */
  createdAt: isoDateTimeSchema.nullable(),
});
export type CommitteeViewLink = z.infer<typeof committeeViewLinkSchema>;

/**
 * The committee's current link, or all-null when it has none. Readable by the committee's lead
 * too, so they can share it; an archived club or committee is still readable (ADR 0015).
 */
export const getCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/committees/:committeeId/view-link',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeViewLinkSchema,
});

/**
 * Creates the link, or replaces it with a new one in a single step — the old link stops working
 * immediately. 409 `club_archived` / `committee_archived`.
 */
export const rotateCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/view-link',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeViewLinkSchema,
});

/**
 * Turns the link off. Idempotent: a committee without one answers 204 as well. The committee can
 * be given a new link afterwards. 409 `club_archived` / `committee_archived`.
 */
export const disableCommitteeViewLinkEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/committees/:committeeId/view-link',
  access: 'actor',
  params: committeeParamsSchema,
  response: null,
});

// ─── Public committee view (no login) ────────────────────────
// Members of the committee open the link, search for their own name and read the points they
// earned in that committee. The token is the only thing that grants this, so it stands in for the
// Actor: there is no session, no cookie and no scope built from a user.
//
// The response schemas below are a WHITELIST: every response is parsed through them before it is
// sent, so a field that is not listed here cannot leave the server even if a mapper produces it.
// NEVER add contact data (phone, university or personal email), study details, other committees,
// other clubs, who recorded a transaction, cancelled transactions, revisions, or any id that an
// authenticated endpoint accepts. The membership type's NAME is the one deliberate exception
// (ADR 0023, amended 2026-10-24) — never its id or its place in the club's order.
// `src/shared/contracts/__tests__/clubs.test.ts` fails if these shapes grow.

/** `User.publicId` (cuid2): random, exposed on purpose, and accepted by no other endpoint. */
export const publicIdSchema = z.string().regex(/^[a-z0-9]{20,40}$/);

/** The title the club gives the member (`MembershipType.name`): the name alone, never the type's id. */
const publicMembershipTypeSchema = z.object({ name: z.string() });

const publicViewParamsSchema = z.object({ token: viewTokenSchema });

/**
 * The names shown at the top of the public page. An invalid, renewed, turned-off or archived
 * token answers the same 404 as any other, so nobody can tell the cases apart.
 */
export const publicCommitteeViewSchema = z.object({
  committee: z.object({ name: z.string() }),
  club: z.object({ name: z.string() }),
});
export type PublicCommitteeView = z.infer<typeof publicCommitteeViewSchema>;

export const publicCommitteeViewEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token',
  access: 'public',
  params: publicViewParamsSchema,
  response: publicCommitteeViewSchema,
});

/** At least two characters, so the search cannot be used to list the whole committee. */
export const PUBLIC_MEMBER_SEARCH_MIN = 2;

/** At most this many matches, for the same reason. There is no pagination and no total. */
export const PUBLIC_MEMBER_SEARCH_LIMIT = 20;

/**
 * Members of this committee whose name matches `q`, folded the same way as the members list
 * (أ/إ/آ, ة/ه, ى/ي, diacritics, repeated spaces). Removed members never appear.
 */
export const publicMemberSearchQuerySchema = z.object({
  q: z.string().trim().min(PUBLIC_MEMBER_SEARCH_MIN).max(60),
});
export type PublicMemberSearchQuery = z.output<typeof publicMemberSearchQuerySchema>;

export const publicMemberSearchResultSchema = z.object({
  items: z
    .array(
      z.object({
        publicId: publicIdSchema,
        fullName: z.string(),
        membershipType: publicMembershipTypeSchema,
        /** Sum of this member's ACTIVE transactions in this committee only. */
        balance: z.number().int(),
      }),
    )
    .max(PUBLIC_MEMBER_SEARCH_LIMIT),
});
export type PublicMemberSearchResult = z.infer<typeof publicMemberSearchResultSchema>;

export const searchPublicCommitteeMembersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token/members',
  access: 'public',
  params: publicViewParamsSchema,
  query: publicMemberSearchQuerySchema,
  response: publicMemberSearchResultSchema,
});

/**
 * One member's points in this committee: their balance and their history, newest work date
 * first. Active transactions only — a cancelled one is not shown publicly at all. A member who
 * was removed from the committee or the club is a 404, even by their exact `publicId`.
 */
export const publicMemberPointsQuerySchema = z.object(paginationShape);
export type PublicMemberPointsQuery = z.output<typeof publicMemberPointsQuerySchema>;

export const publicMemberPointsSchema = z.object({
  member: z.object({
    publicId: publicIdSchema,
    fullName: z.string(),
    membershipType: publicMembershipTypeSchema,
  }),
  /** Sum of the member's ACTIVE transactions in this committee only. */
  balance: z.number().int(),
  transactions: paginated(
    z.object({ amount: z.number().int(), reason: z.string(), workDate: isoDateSchema }),
  ),
});
export type PublicMemberPoints = z.infer<typeof publicMemberPointsSchema>;

export const publicMemberPointsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/committee-views/:token/members/:publicId/points',
  access: 'public',
  params: publicViewParamsSchema.extend({ publicId: publicIdSchema }),
  query: publicMemberPointsQuerySchema,
  response: publicMemberPointsSchema,
});
