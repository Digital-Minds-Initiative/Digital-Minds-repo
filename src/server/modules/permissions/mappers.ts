import 'server-only';

import { authorName } from '@/server/people';
import type { RoleChange } from '@/shared/contracts/permissions';

import type { RoleChangeRow } from './repository';

/** Database row → API contract. Only fields listed in the contract leave the server. */
export function toRoleChange(row: RoleChangeRow): RoleChange {
  return {
    id: row.id,
    clubId: row.clubId,
    committee: row.committee ? { id: row.committee.id, name: row.committee.name } : null,
    member: { memberId: row.membership.id, fullName: row.membership.user.fullName },
    changedBy: { userId: row.changedBy.id, fullName: authorName(row.changedBy) },
    previousRole: row.previousRole,
    newRole: row.newRole,
    createdAt: row.createdAt.toISOString(),
  };
}
