import 'server-only';

import type { MemberScope } from '@/server/authz';
import { db } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';

const cardSelect = {
  id: true,
  role: true,
  club: { select: { id: true, name: true, slug: true } },
  membershipType: { select: { name: true } },
  user: { select: { fullName: true } },
  committeeMemberships: {
    where: { removedAt: null },
    orderBy: { committee: { name: 'asc' } },
    select: { role: true, committee: { select: { name: true } } },
  },
} satisfies Prisma.MembershipSelect;

export type CardRow = Prisma.MembershipGetPayload<{ select: typeof cardSelect }>;

/** The memberships the scope reaches — for a card, always the caller's own — newest club name last. */
export async function findCardRows(scope: MemberScope): Promise<CardRow[]> {
  return db.membership.findMany({
    where: { AND: [scope, { removedAt: null }] },
    select: cardSelect,
    orderBy: { club: { name: 'asc' } },
  });
}
