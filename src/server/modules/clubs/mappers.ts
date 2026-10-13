import 'server-only';

import type { Club, Committee, MembershipType } from '@/shared/contracts/clubs';

import type { ClubRow, CommitteeRow, MembershipTypeRow, MembershipTypeUsage } from './repository';

/** Database rows → API contracts. Only fields listed in the contract leave the server. */

export function toClub(row: ClubRow): Club {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export function toCommittee(row: CommitteeRow): Committee {
  return {
    id: row.id,
    clubId: row.clubId,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export function toMembershipType(
  row: MembershipTypeRow,
  usage: MembershipTypeUsage | undefined,
): MembershipType {
  return {
    id: row.id,
    clubId: row.clubId,
    name: row.name,
    order: row.order,
    activeMemberCount: usage?.active ?? 0,
    // Removed memberships keep their type for history, so they count as "in use" even though
    // they are not shown in activeMemberCount.
    inUse: (usage?.total ?? 0) > 0,
  };
}
