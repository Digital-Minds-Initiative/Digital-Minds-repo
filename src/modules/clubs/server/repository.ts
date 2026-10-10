import 'server-only';

import type { ClubScope, CommitteeScope } from '@/server/authz';
import { db } from '@/server/db/client';

export interface ClubRef {
  id: string;
  name: string;
  slug: string;
}

export interface CommitteeRef {
  id: string;
  clubId: string;
  name: string;
}

export async function findClubRefs(
  scope: ClubScope,
  options: { includeArchived: boolean },
): Promise<ClubRef[]> {
  return db.club.findMany({
    where: { AND: [scope, options.includeArchived ? {} : { archivedAt: null }] },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

export async function findCommitteeRefs(
  scope: CommitteeScope,
  options: { includeArchived: boolean },
): Promise<CommitteeRef[]> {
  return db.committee.findMany({
    where: {
      AND: [scope, options.includeArchived ? {} : { archivedAt: null, club: { archivedAt: null } }],
    },
    select: { id: true, clubId: true, name: true },
    orderBy: [{ club: { name: 'asc' } }, { name: 'asc' }],
  });
}
