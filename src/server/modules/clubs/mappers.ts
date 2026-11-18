import 'server-only';

import { authorName } from '@/server/people';
import type {
  Club,
  Committee,
  MembershipType,
  MembershipTypeChange,
} from '@/shared/contracts/clubs';

import type {
  ClubRow,
  CommitteeRow,
  MembershipTypeChangeRow,
  MembershipTypeRow,
  MembershipTypeUsage,
} from './repository';

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

/**
 * A history row → the shape of its kind. The CHECK constraints guarantee each kind's columns, so
 * a missing one is a broken row, not something to send half-filled.
 */
export function toMembershipTypeChange(row: MembershipTypeChangeRow): MembershipTypeChange {
  const base = {
    id: row.id,
    clubId: row.clubId,
    changedBy: { userId: row.changedBy.id, fullName: authorName(row.changedBy) },
    createdAt: row.createdAt.toISOString(),
  };
  switch (row.kind) {
    case 'TYPE_CREATED':
      return { ...base, kind: row.kind, name: present(row.newName, row) };
    case 'TYPE_RENAMED':
      return {
        ...base,
        kind: row.kind,
        previousName: present(row.previousName, row),
        newName: present(row.newName, row),
      };
    case 'TYPE_DELETED':
      return {
        ...base,
        kind: row.kind,
        name: present(row.previousName, row),
        movedMembers: present(row.movedMembers, row),
        movedTo: row.newName,
      };
    case 'MEMBER_TYPE_CHANGED': {
      const membership = present(row.membership, row);
      return {
        ...base,
        kind: row.kind,
        member: { memberId: membership.id, fullName: membership.user.fullName },
        source: present(row.source, row),
        previousType: present(row.previousName, row),
        newType: present(row.newName, row),
      };
    }
  }
}

function present<T>(value: T | null, row: { id: string; kind: string }): T {
  if (value === null) throw new Error(`MembershipTypeChange ${row.id} (${row.kind}) is incomplete`);
  return value;
}
