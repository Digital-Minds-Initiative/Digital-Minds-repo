import { z } from 'zod';

import { defineEndpoint, idSchema } from '@/lib/contracts';

/*
 * Roles are granted manually and are hierarchical:
 *   full admin (flag on the account) → appoints club officers
 *   club officer (role on a club membership) → appoints committee leads in that club
 *   committee lead (role on a committee membership) → appoints nobody
 * The full-admin flag is not grantable through the API (seed / one-off script only).
 */

export const clubRoleSchema = z.enum(['MEMBER', 'CLUB_OFFICER']);
export type ClubRole = z.infer<typeof clubRoleSchema>;

export const committeeRoleSchema = z.enum(['MEMBER', 'LEAD']);
export type CommitteeRole = z.infer<typeof committeeRoleSchema>;

const memberParamsSchema = z.object({ memberId: idSchema });
const memberCommitteeParamsSchema = z.object({ memberId: idSchema, committeeId: idSchema });

/** Appoint (CLUB_OFFICER) or revoke (MEMBER) a club officer. Full admins only. */
export const setClubRoleEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/members/:memberId/role',
  access: 'actor',
  params: memberParamsSchema,
  body: z.object({ role: clubRoleSchema }),
  response: z.object({ memberId: idSchema, role: clubRoleSchema }),
});

/**
 * Appoint (LEAD) or revoke (MEMBER) a committee lead. Club officers of that club and full admins.
 * The member must already be in the committee.
 */
export const setCommitteeRoleEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/members/:memberId/committees/:committeeId/role',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  body: z.object({ role: committeeRoleSchema }),
  response: z.object({ memberId: idSchema, committeeId: idSchema, role: committeeRoleSchema }),
});

const roleHolderSchema = z.object({
  memberId: idSchema,
  userId: idSchema,
  fullName: z.string(),
});

/** Who holds officer and lead roles in a club. Club officers of that club and full admins. */
export const listClubPermissionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/permissions',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  response: z.object({
    officers: z.array(roleHolderSchema),
    leads: z.array(
      roleHolderSchema.extend({ committee: z.object({ id: idSchema, name: z.string() }) }),
    ),
  }),
});
