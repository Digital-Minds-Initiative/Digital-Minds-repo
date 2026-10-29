import 'server-only';

import type { MemberBalances } from '@/server/modules/points';
import { liveUniEmail } from '@/server/people';
import type { Member } from '@/shared/contracts/members';

import type { MemberRow } from './repository';

const NO_POINTS: MemberBalances = { total: 0, byCommittee: new Map() };

/**
 * Database row → API contract. Only fields listed in the contract leave the server.
 *
 * `pointsIn` is the committee the list is filtered to, or null for every committee the caller
 * can see. The balances are already limited to the requested work-date period, so each figure is
 * the one the column is showing (docs/adr/0020-members-list-filtering.md).
 */
export function toMember(
  row: MemberRow,
  balances: MemberBalances = NO_POINTS,
  pointsIn: string | null = null,
): Member {
  return {
    id: row.id,
    user: {
      id: row.user.id,
      fullName: row.user.fullName,
      uniEmail: liveUniEmail(row.user.uniEmail),
      isRegistered: row.user.registeredAt !== null,
    },
    profile: {
      personalEmail: row.personalEmail,
      phone: row.phone,
      college: row.college,
      major: row.major,
      level: row.level,
      gender: row.gender,
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
    // Without a committee filter this is the total, which can exceed what the committees above
    // add up to: points earned in a committee the person has since left still count for the club
    // (ADR 0017). With one, it is that committee's figure — so it is one of the entries above
    // rather than their sum, which `pointsBasis` on the list response explains.
    points: pointsIn === null ? balances.total : (balances.byCommittee.get(pointsIn) ?? 0),
    joinedAt: row.createdAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}
