import { normalizeForSearch } from '@/shared/lib/arabic';
import { phoneSearchDigits } from '@/shared/lib/phone';

/** What the points page searches in: the parts of a member that identify them. */
export interface SearchableMember {
  fullName: string;
  uniEmail: string;
  /** This club's copy of the phone, stored as E.164; null when the club has none. */
  phone: string | null;
}

/** Anything but digits (Latin, Arabic-Indic, Persian), spaces and the punctuation of a number. */
const NOT_PHONE_CHARACTERS = /[^\d\s+\-().٠-٩۰-۹]/;

/**
 * Whether the member's phone is what the search is looking for: the digits people type in front of
 * a number (`0`, `966`, `00966`) are dropped, as the members API does, and a query too short to
 * be a phone matches nothing. Also decides when a row shows the phone at all.
 */
export function phoneMatchesSearch(phone: string | null, query: string): boolean {
  // Unlike the members API, text with letters or an `@` is not a phone: the digits in an email
  // (`s4400123@…`) would otherwise find other members by their phone.
  if (NOT_PHONE_CHARACTERS.test(query)) return false;
  const digits = phoneSearchDigits(query);
  return digits !== null && (phone ?? '').includes(digits);
}

/**
 * The members list's search (`q`, src/server/modules/members/repository.ts) applied to a roster
 * the page already holds: the Arabic-folded name, the university email in any case, or the phone
 * digits. An empty search matches everyone.
 */
export function matchesMemberSearch(member: SearchableMember, query: string): boolean {
  const name = normalizeForSearch(query);
  if (!name) return true;
  return (
    normalizeForSearch(member.fullName).includes(name) ||
    member.uniEmail.toLowerCase().includes(query.trim().toLowerCase()) ||
    phoneMatchesSearch(member.phone, query)
  );
}
