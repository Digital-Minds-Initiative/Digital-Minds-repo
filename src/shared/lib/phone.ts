import { toLatinDigits } from './arabic';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises a phone number to E.164 (`+9665XXXXXXXX`).
 * Accepts the Saudi formats people actually type (05XXXXXXXX, 5XXXXXXXX, 9665…, 009665…),
 * Arabic-Indic digits, spaces and dashes, and any international number already in E.164.
 * Returns null when the input is not a phone number.
 */
export function normalizePhone(input: string): string | null {
  const compact = toLatinDigits(input).replace(/[\s\-().]/g, '');
  if (/^05\d{8}$/.test(compact)) return `+966${compact.slice(1)}`;
  if (/^5\d{8}$/.test(compact)) return `+966${compact}`;
  if (/^9665\d{8}$/.test(compact)) return `+${compact}`;
  if (/^00[1-9]\d{7,14}$/.test(compact)) return `+${compact.slice(2)}`;
  if (E164.test(compact)) return compact;
  return null;
}

/**
 * The digits to look for when someone searches by phone. Numbers are stored as E.164 (`+9665…`),
 * so the prefixes people type in front of them — `0` (05XXXXXXXX), `966`, `00966`, `00` — are
 * dropped, and Arabic-Indic digits are converted. Null when fewer than four digits remain: too
 * short to mean a phone number.
 */
export function phoneSearchDigits(query: string): string | null {
  const digits = toLatinDigits(query)
    .replace(/\D/g, '')
    .replace(/^(?:00966|966|00|0)/, '');
  return digits.length >= 4 ? digits : null;
}
