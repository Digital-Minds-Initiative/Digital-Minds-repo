import 'server-only';

import type { UserScope } from '@/server/authz';
import { db } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';

const ownProfileSelect = {
  id: true,
  fullName: true,
  uniEmail: true,
  isFullAdmin: true,
  memberships: {
    where: { removedAt: null },
    orderBy: { club: { name: 'asc' } },
    select: {
      role: true,
      club: { select: { id: true, name: true, slug: true } },
      membershipType: { select: { id: true, name: true } },
      committeeMemberships: {
        where: { removedAt: null },
        orderBy: { committee: { name: 'asc' } },
        select: { role: true, committee: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type OwnProfileRow = Prisma.UserGetPayload<{ select: typeof ownProfileSelect }>;

/** The actor's own account and active memberships. */
export async function findOwnProfile(scope: UserScope): Promise<OwnProfileRow | null> {
  return db.user.findFirst({ where: scope, select: ownProfileSelect });
}
