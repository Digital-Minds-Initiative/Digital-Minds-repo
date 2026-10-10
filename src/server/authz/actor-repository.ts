import 'server-only';

import { db } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';

import type { Actor } from './types';

/*
 * Loads the Actor for a user. This is the one query that runs before any scope exists, so it only
 * ever reads the requesting user's own memberships. Only registered users can act.
 */

const actorSelect = {
  id: true,
  isFullAdmin: true,
  memberships: {
    where: { removedAt: null },
    select: {
      id: true,
      clubId: true,
      role: true,
      committeeMemberships: {
        where: { removedAt: null },
        select: { id: true, committeeId: true, role: true },
      },
    },
  },
} satisfies Prisma.UserSelect;

type ActorRow = Prisma.UserGetPayload<{ select: typeof actorSelect }>;

function toActor(row: ActorRow): Actor {
  return {
    userId: row.id,
    isFullAdmin: row.isFullAdmin,
    memberships: row.memberships.map((membership) => ({
      membershipId: membership.id,
      clubId: membership.clubId,
      role: membership.role,
      committees: membership.committeeMemberships.map((committee) => ({
        committeeMembershipId: committee.id,
        committeeId: committee.committeeId,
        role: committee.role,
      })),
    })),
  };
}

export async function findActorByUserId(userId: string): Promise<Actor | null> {
  const row = await db.user.findFirst({
    where: { id: userId, registeredAt: { not: null } },
    select: actorSelect,
  });
  return row ? toActor(row) : null;
}

export async function findActorByUniEmail(uniEmail: string): Promise<Actor | null> {
  const row = await db.user.findFirst({
    where: { uniEmail: uniEmail.toLowerCase(), registeredAt: { not: null } },
    select: actorSelect,
  });
  return row ? toActor(row) : null;
}
