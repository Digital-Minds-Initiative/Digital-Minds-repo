import 'server-only';

import type { Member } from '@/shared/contracts/members';

import type { MemberRow } from './repository';

/** Database row → API contract. Only fields listed in the contract leave the server. */
export function toMember(row: MemberRow, points: number): Member {
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
    })),
    points,
    joinedAt: row.createdAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}
