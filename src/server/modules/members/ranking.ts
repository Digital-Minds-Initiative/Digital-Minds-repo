import 'server-only';

/**
 * Ordering a points ranking. Pure, and deliberately not left to the database: the figure is an
 * aggregate two relations away and the list's `where` is a branded scope that must not be
 * rewritten as SQL by hand (docs/adr/0020-members-list-filtering.md).
 */

export interface RankedMember {
  id: string;
  /** The Arabic-folded name, so أ/إ/آ and ة/ه variants of one name tie with each other. */
  searchName: string;
  points: number;
}

/**
 * Sorts by points, then by the folded name, then by the id — a *total* order, so the result does
 * not depend on the order the rows arrived in, and a member can never repeat or vanish between
 * one page and the next.
 *
 * Returns a new array; the input is left alone.
 */
export function rankByPoints<T extends RankedMember>(
  members: readonly T[],
  order: 'asc' | 'desc',
): T[] {
  const direction = order === 'desc' ? -1 : 1;
  return [...members].sort(
    (a, b) =>
      direction * (a.points - b.points) ||
      compare(a.searchName, b.searchName) ||
      compare(a.id, b.id),
  );
}

/**
 * Code-unit order, which for the folded Arabic alphabet is alphabetical order and matches what
 * Postgres gives for the same strings (docs/adr/0020-members-list-filtering.md). Deliberately not
 * `localeCompare`: that depends on the runtime's locale data, and this order has to be stable
 * across machines.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
