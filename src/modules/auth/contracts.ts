import { z } from 'zod';

import { defineEndpoint, idSchema } from '@/lib/contracts';
import {
  clubCommitteeRefSchema,
  clubRefSchema,
  committeeRefSchema,
} from '@/modules/clubs/contracts';
import { clubRoleSchema, committeeRoleSchema } from '@/modules/members/contracts';

/*
 * Dev actor switcher (development and tests only). The value is a seeded user's university email.
 * The server ignores both in production builds — see src/server/actor.ts.
 */
export const DEV_ACTOR_COOKIE = 'dm-dev-actor';
export const DEV_ACTOR_HEADER = 'x-dev-actor';

const meMembershipSchema = z.object({
  club: clubRefSchema,
  role: clubRoleSchema,
  membershipType: z.object({ id: idSchema, name: z.string() }),
  committees: z.array(committeeRefSchema.extend({ role: committeeRoleSchema })),
});

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    uniEmail: z.string(),
    isFullAdmin: z.boolean(),
  }),
  /** The caller's own active memberships. */
  memberships: z.array(meMembershipSchema),
  /** What the caller may open in the dashboard. Drives navigation and filters. */
  access: z.object({
    canAccessDashboard: z.boolean(),
    /** Create and archive clubs, appoint officers (full admins). */
    canManageClubs: z.boolean(),
    clubs: z.array(clubRefSchema.extend({ canManage: z.boolean() })),
    committees: z.array(clubCommitteeRefSchema),
  }),
});
export type Me = z.infer<typeof meSchema>;

/** The signed-in user and their access. 401 when nobody is signed in. */
export const meEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me',
  access: 'actor',
  response: meSchema,
});
