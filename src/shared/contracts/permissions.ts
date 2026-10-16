import { z } from 'zod';

import { committeeRefSchema } from '@/shared/contracts/clubs';
import {
  defineEndpoint,
  idSchema,
  isoDateTimeSchema,
  paginated,
  paginationShape,
} from '@/shared/contracts/core';
import {
  clubRoleSchema,
  committeeRoleSchema,
  memberCommitteeParamsSchema,
  memberParamsSchema,
  memberSchema,
} from '@/shared/contracts/members';

/*
 * Granting and revoking roles (docs/adr/0018-granting-roles.md).
 *
 *   full admin (flag on the account) → appoints and revokes club officers
 *   club officer                     → appoints and revokes committee leads in their own club
 *   committee lead                   → appoints nobody, and sees no role history
 *
 * The full-admin flag is not grantable through the API (seed or a one-off script only). The role
 * enums live with the membership rows that store them (members contracts).
 *
 * Granting a role the person already holds, or revoking one they do not, writes nothing and
 * answers 200 with the member unchanged — the same rule as a PATCH that changes nothing
 * ([ADR 0017](0017-member-permissions.md)). No history row is written for it.
 */

// ─── Granting and revoking ───────────────────────────────────
// Both answer with the member, so one call refreshes the row the UI is showing.

/**
 * Appoint (`CLUB_OFFICER`) or revoke (`MEMBER`) a club officer. Full admins only — an officer
 * does not decide who else runs their club, not even themselves (403 `full_admin_required`).
 *
 * The person must have an active membership in the club (409 `member_removed` otherwise), and
 * the club must not be archived (409 `club_archived`).
 */
export const setClubRoleEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/members/:memberId/role',
  access: 'actor',
  params: memberParamsSchema,
  body: z.strictObject({ role: clubRoleSchema }),
  response: memberSchema,
});

/**
 * Appoint (`LEAD`) or revoke (`MEMBER`) a committee lead: the club's officers and full admins
 * (403 `club_management_required`). A committee can have several leads, and an officer may
 * appoint themselves — it grants them nothing they do not already have over their own club.
 *
 * The person must already be in the committee: this only sets the role of a membership that is
 * there (409 `not_in_committee`), adding is `PUT /members/:memberId/committees/:committeeId`.
 * Neither the club nor the committee may be archived.
 */
export const setCommitteeRoleEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/members/:memberId/committees/:committeeId/role',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  body: z.strictObject({ role: committeeRoleSchema }),
  response: memberSchema,
});

// ─── Who holds which role now ────────────────────────────────

const roleHolderSchema = z.object({
  /** Membership id — the same id the members endpoints use. */
  memberId: idSchema,
  userId: idSchema,
  fullName: z.string(),
});

/** Who holds officer and lead roles in a club. The club's officers and full admins. */
export const clubPermissionsSchema = z.object({
  officers: z.array(roleHolderSchema),
  leads: z.array(roleHolderSchema.extend({ committee: committeeRefSchema })),
});
export type ClubPermissions = z.infer<typeof clubPermissionsSchema>;

export const listClubPermissionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/permissions',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  response: clubPermissionsSchema,
});

// ─── Role history ────────────────────────────────────────────

/**
 * A role as history records it. `MEMBER` is the absence of a role, so a grant reads
 * `MEMBER → CLUB_OFFICER` and a revoke `LEAD → MEMBER`.
 */
export const grantableRoleSchema = z.enum(['MEMBER', 'CLUB_OFFICER', 'LEAD']);
export type GrantableRole = z.infer<typeof grantableRoleSchema>;

export const roleChangeSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  /** Null for a club-officer change. */
  committee: committeeRefSchema.nullable(),
  /** Whose role changed. Removed members keep their history. */
  member: z.object({ memberId: idSchema, fullName: z.string() }),
  /** Who changed it. A full admin need not be a member of the club, so this is an account. */
  changedBy: z.object({ userId: idSchema, fullName: z.string() }),
  previousRole: grantableRoleSchema,
  newRole: grantableRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type RoleChange = z.infer<typeof roleChangeSchema>;

export const roleHistoryQuerySchema = z.object({ ...paginationShape });
export type RoleHistoryQuery = z.output<typeof roleHistoryQuerySchema>;

export const roleHistoryResponseSchema = paginated(roleChangeSchema);
export type RoleHistoryResponse = z.infer<typeof roleHistoryResponseSchema>;

/**
 * A club's grants and revokes, newest first. The club's officers and full admins; a committee
 * lead sees none of it (403 `club_management_required`).
 *
 * Explicit changes only: a role cleared by removing someone from a committee or from the club is
 * not a row here (docs/adr/0018-granting-roles.md).
 */
export const listRoleHistoryEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/role-history',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  query: roleHistoryQuerySchema,
  response: roleHistoryResponseSchema,
});
