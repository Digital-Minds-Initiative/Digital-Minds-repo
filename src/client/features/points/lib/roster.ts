import type { Member } from '@/shared/contracts/members';
import { normalizeForSearch } from '@/shared/lib/arabic';

/** One member of the committee as the points page lists them. */
export interface RosterRow {
  /** Membership id. */
  id: string;
  fullName: string;
  /** The role in this committee. */
  role: 'LEAD' | 'MEMBER';
  /** The member's active points in this committee. */
  balance: number;
  /** 1 for the highest balance; ties share a place. */
  rank: number;
}

export type RosterSort = 'points' | 'lowest' | 'name';

/**
 * One row per member of the committee, from the members list: the balance is the member's points
 * in that committee (`committees[].points`), which the server limits to what the caller may see.
 * Members are ranked by balance, and the ranks do not depend on the search or the sort, so the
 * top places keep their marks while the list is filtered.
 */
export function buildRoster(members: readonly Member[], committeeId: string): RosterRow[] {
  const rows = members.flatMap((member) => {
    const link = member.committees.find((committee) => committee.id === committeeId);
    return link
      ? [{ id: member.id, fullName: member.user.fullName, role: link.role, balance: link.points }]
      : [];
  });
  const balances = rows.map((row) => row.balance).sort((a, b) => b - a);
  return rows.map((row) => ({ ...row, rank: balances.indexOf(row.balance) + 1 }));
}

/** Keeps the rows whose name contains the search (Arabic-normalised), then orders them. */
export function arrange(
  rows: readonly RosterRow[],
  options: { search: string; sort: RosterSort },
): RosterRow[] {
  const needle = normalizeForSearch(options.search);
  const matching = needle
    ? rows.filter((row) => normalizeForSearch(row.fullName).includes(needle))
    : [...rows];
  const byName = (a: RosterRow, b: RosterRow) => a.fullName.localeCompare(b.fullName, 'ar');
  return matching.sort((a, b) => {
    switch (options.sort) {
      case 'points':
        return b.balance - a.balance || byName(a, b);
      case 'lowest':
        return a.balance - b.balance || byName(a, b);
      case 'name':
        return byName(a, b);
    }
  });
}
