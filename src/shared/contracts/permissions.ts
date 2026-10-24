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

// ─── Invitations ─────────────────────────────────────────────

/**
 * At most this many invitation emails per person per day — the automatic one sent with a grant
 * counts — in fixed UTC days. Only emails that were actually sent count
 * (docs/adr/0027-invite-only-sign-in.md).
 */
export const INVITATIONS_PER_PERSON_PER_DAY = 3;

/**
 * What happened to the invitation a grant sends when the person has not signed in yet:
 *   - `sent`: the email went out;
 *   - `failed`: the email provider refused it — the role is granted anyway, and it can be resent;
 *   - `limited`: the person already got today's invitations; `retryAfterSeconds` until the next.
 */
export const invitationOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('sent'), sentAt: isoDateTimeSchema }),
  z.object({ status: z.literal('failed') }),
  z.object({ status: z.literal('limited'), retryAfterSeconds: z.number().int().positive() }),
]);
export type InvitationOutcome = z.infer<typeof invitationOutcomeSchema>;

// ─── Granting and revoking ───────────────────────────────────
// Both answer with the member, so one call refreshes the row the UI is showing, and with what
// became of the invitation: null when none was due — a revoke, a role they already held, or a
// person who has already signed in.

export const setRoleResponseSchema = z.object({
  member: memberSchema,
  invitation: invitationOutcomeSchema.nullable(),
});
export type SetRoleResponse = z.infer<typeof setRoleResponseSchema>;

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
  response: setRoleResponseSchema,
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
  response: setRoleResponseSchema,
});

// ─── Resending an invitation ─────────────────────────────────

/**
 * Sends the club-officer invitation again to someone who holds the role and has not signed in.
 * Whoever may grant the role may resend it: full admins only (403 `full_admin_required`).
 *
 * 409 `already_registered` once they have signed in, `no_role` when they are not an officer of
 * the club, `member_removed`, `club_archived`. 429 `too_many_invitations` with `Retry-After` past
 * `INVITATIONS_PER_PERSON_PER_DAY`. A send the email provider refuses is a 500 and is not counted.
 */
export const resendClubInvitationEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/:memberId/role/invitation',
  access: 'actor',
  params: memberParamsSchema,
  response: z.object({ sentAt: isoDateTimeSchema }),
});

/**
 * The same for a committee lead: the club's officers and full admins
 * (403 `club_management_required`). `no_role` when they do not lead this committee; also
 * `committee_archived`.
 */
export const resendCommitteeInvitationEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/:memberId/committees/:committeeId/role/invitation',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  response: z.object({ sentAt: isoDateTimeSchema }),
});

// ─── Who holds which role now ────────────────────────────────

const roleHolderSchema = z.object({
  /** Membership id — the same id the members endpoints use. */
  memberId: idSchema,
  userId: idSchema,
  fullName: z.string(),
  /** False until the person signs in for the first time. */
  registered: z.boolean(),
  /**
   * When this club last sent them an invitation, or null. Only for people who have not
   * registered; another club's invitations are not counted (ADR 0012).
   */
  invitedAt: isoDateTimeSchema.nullable(),
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
  /**
   * Who changed it. A full admin need not be a member of the club, so this is an account.
   * `fullName` is null once that person's data was deleted (ADR 0026); the UI shows «عضو محذوف».
   */
  changedBy: z.object({ userId: idSchema, fullName: z.string().nullable() }),
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
