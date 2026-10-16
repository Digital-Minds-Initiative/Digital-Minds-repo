import 'server-only';

import type { MemberBalances } from '@/server/modules/points';
import type { Member } from '@/shared/contracts/members';

import type { MemberRow } from './repository';

const NO_POINTS: MemberBalances = { total: 0, byCommittee: new Map() };

/** Database row → API contract. Only fields listed in the contract leave the server. */
export function toMember(row: MemberRow, balances: MemberBalances = NO_POINTS): Member {
  return {
    id: row.id,
    user: {
      id: row.user.id,
      fullName: row.user.fullName,
      uniEmail: row.user.uniEmail,
      isRegistered: row.user.registeredAt !== null,
    },
    profile: {
      personalEmail: row.personalEmail,
      phone: row.phone,
      college: row.college,
      major: row.major,
      level: row.level,
    },
    club: row.club,
    membershipType: row.membershipType,
    role: row.role,
    committees: row.committeeMemberships.map((committeeMembership) => ({
      id: committeeMembership.committee.id,
      name: committeeMembership.committee.name,
      role: committeeMembership.role,
      points: balances.byCommittee.get(committeeMembership.committee.id) ?? 0,
    })),
    // The total can exceed what the committees above add up to: points earned in a committee the
    // person has since left still count for the club (ADR 0017).
    points: balances.total,
    joinedAt: row.createdAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}
